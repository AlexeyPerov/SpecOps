import type { ChatMessage, ChatMessagePart, ToolCallRecord } from "../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import { appState } from "../state/appState";
import { chatStore, type ChatTurnError } from "../state/chatStore";
import { scheduleSessionThreadFilePersistence } from "../services/chatPersistence";
import {
  WorkspaceAgentBackendError,
  createWorkspaceAgentBackend,
  type WorkspaceAgentSendContext,
} from "./backends/workspaceAgentBackend";
import { buildThreadProviderRequest } from "./modes/prompt";
import {
  formatRetryFailureNote,
  PROVIDER_UNAVAILABLE_MESSAGE,
  sanitizeUnexpectedProviderError,
  WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
} from "./chatErrorCopy";
import {
  getDebugProviderSendBlockHint,
  isDebugProviderSendBlocked,
} from "./providers/debugProviderSettings";
import {
  getHttpProviderMissingConfigMessage,
  isHttpProviderSendBlocked,
  resolveHttpConnection,
} from "./providers/httpConnectionSettings";
import { validateLocalModelSelection } from "./providers/capabilityChecker";
import { resolveComposerModelId } from "./providers/threadModelCatalog";
import { getChatProvider } from "./providers/registry";
import type { ChatProvider, ProviderSendRequest } from "./providers/types";
import { isChatProviderError, streamProviderMessage } from "./chatSend";
import {
  applyToolCompleted,
  applyToolProgress,
  applyToolStarted,
} from "./toolCallReducer";
import {
  applyReasoningDelta,
  applyReasoningEnded,
  applyStepFailed,
  applyStepFinished,
  applyStepStarted,
  applySubtaskStarted,
} from "./chatStreamParts";
import { promptPermission } from "../services/permissionPrompt";
import { promptQuestion } from "../services/questionPrompt";
import type { WorkspacePermissionReply } from "./backends/workspaceAgentBackend";
import type { WorkspaceAccessStatus } from "./capabilities";
import {
  logChatProviderPayload,
  logChatSendComplete,
  logChatSendFailed,
  logChatSendStart,
} from "./chatDiagnostics";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";
import { resolveOpencodeModelFallback } from "./opencodeCatalog";
import { isOpencodeEnabled } from "../services/opencodeSettings";
import { ensureOpencodeSidecar } from "../services/opencodeSidecarEnsure";
import {
  OPENCODE_DISABLED_MESSAGE,
} from "./chatErrorCopy";

export type SendChatMessageFailureReason =
  | "empty"
  | "no_workspace"
  | "no_session"
  | "generating"
  | "preflight"
  | "debug_disabled"
  | "http_not_configured"
  | "invalid_model"
  | "provider_unavailable"
  | "append_failed"
  | "provider_error";

export type ChatTurnSuccessResult = {
  ok: true;
  turnId: string;
  assistantMessageId: string;
  sessionId: string;
};

export type SendChatMessageResult =
  | ChatTurnSuccessResult
  | { ok: false; reason: SendChatMessageFailureReason; message: string };

type ProviderSendValidationFailure = {
  ok: false;
  reason: SendChatMessageFailureReason;
  message: string;
};

type ProviderSendValidationSuccess = {
  ok: true;
  provider: ChatProvider;
  accessStatus: WorkspaceAccessStatus;
  modelId: string;
  connectionId?: string;
};

type OpencodeBackendSendValidation = {
  ok: true;
  modelId: string;
};

type ChatSendTargetFailure = {
  ok: false;
  reason: Extract<SendChatMessageFailureReason, "no_workspace" | "no_session">;
  message: string;
};

type ChatSendTargetSuccess = {
  ok: true;
  root: string;
  chatContextKind: ChatContextKind;
  activeSessionId: string;
};

export type ChatContextKind = "workspace" | "chat-http";

export interface ChatSendContextOptions {
  chatContextKind?: ChatContextKind;
  /** Composer-assembled mentions / attachments (M3-T1..T3). Only forwarded
   * for workspace-session sends; ignored by Chat-HTTP providers. */
  context?: WorkspaceAgentSendContext;
  /** Delivery mode for prompts sent while a turn is running (M3-T5). */
  queueMode?: ChatQueueMode;
}

/** How a prompt sent while a turn is running is handled (M3-T5). */
export type ChatQueueMode = "queue" | "steer";

class TurnCancelledError extends Error {
  constructor() {
    super("Turn cancelled");
    this.name = "TurnCancelledError";
  }
}

function isTurnCancelledError(error: unknown): error is TurnCancelledError {
  return error instanceof TurnCancelledError;
}

export function createUserMessage(content: string): ChatMessage {
  const createdAt = new Date().toISOString();
  return {
    id: `msg-${createdAt}-${Math.floor(Math.random() * 1000)}`,
    role: "user",
    content,
    createdAt,
  };
}

function createAssistantPlaceholder(turnId: string): ChatMessage {
  const createdAt = new Date().toISOString();
  return {
    id: `assistant-${turnId}`,
    role: "assistant",
    content: "",
    createdAt,
  };
}

export function persistSessionThreadOnce(scopeKey: string, sessionId: string): void {
  const thread = chatStore.getWorkspaceSessionsState(scopeKey)?.threadsBySessionId[sessionId] ?? null;
  if (!thread || !thread.messages.some((message) => message.role === "user")) {
    return;
  }
  scheduleSessionThreadFilePersistence(scopeKey, sessionId, {
    version: 1,
    thread,
  });
}

export function abortTurn(sessionId: string, workspaceRoot?: string | null): void {
  chatStore.completeTurn(sessionId, workspaceRoot);
}

async function abortWorkspaceBackendSession(input: {
  root: string;
  activeSessionId: string;
  backend: ReturnType<typeof createWorkspaceAgentBackend>;
}): Promise<void> {
  const link = chatStore.getSessionLink(input.activeSessionId, input.root);
  const opencodeSessionId = link?.opencodeSessionId?.trim() ?? "";
  if (!opencodeSessionId) {
    return;
  }
  try {
    await input.backend.abortSession({
      workspaceRootPath: input.root,
      sessionId: opencodeSessionId,
    });
  } catch (error: unknown) {
    if (error instanceof WorkspaceAgentBackendError && error.code === "notFound") {
      return;
    }
    throw error;
  }
}

function assertTurnStillActive(root: string, sessionId: string, turnId: string): void {
  if (!chatStore.isGenerationTurnActive(root, sessionId, turnId)) {
    throw new TurnCancelledError();
  }
}

async function awaitWithTurnCancellation<T>(
  input: {
    root: string;
    sessionId: string;
    turnId: string;
    pending: Promise<T>;
  },
): Promise<T> {
  const { root, sessionId, turnId, pending } = input;
  if (!chatStore.isGenerationTurnActive(root, sessionId, turnId)) {
    throw new TurnCancelledError();
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      callback();
    };
    const unsubscribe = chatStore.subscribe(() => {
      if (!chatStore.isGenerationTurnActive(root, sessionId, turnId)) {
        finish(() => reject(new TurnCancelledError()));
      }
    });
    pending.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export function findLastUserMessage(messages: ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return message;
    }
  }
  return null;
}

function createRetryFailureNote(turnId: string, previousError: ChatTurnError): ChatMessage {
  const createdAt = new Date().toISOString();
  return {
    id: `retry-note-${turnId}`,
    role: "system",
    content: formatRetryFailureNote(previousError.message),
    createdAt,
  };
}

function noChatScopeMessage(action: "send" | "retry"): string {
  const contextId = appState.getSnapshot().contexts.activeContextId;
  const isChatHttpContext = contextId === CHAT_HTTP_CONTEXT_ID;
  if (action === "retry") {
    return isChatHttpContext
      ? "Open Chat and select a chat thread to retry messages."
      : "Open a workspace to retry chat messages.";
  }
  return isChatHttpContext
    ? "Open Chat and select a chat thread to send messages."
    : "Open a workspace to send chat messages.";
}

export function resolveChatContextKind(root: string, options?: ChatSendContextOptions): ChatContextKind {
  if (options?.chatContextKind) {
    return options.chatContextKind;
  }
  return root === CHAT_HTTP_CONTEXT_ID ? "chat-http" : "workspace";
}

function isWorkspaceContextId(contextId: string): boolean {
  return contextId.startsWith("ws-");
}

export function isWorkspaceSendBlockedWhenOpencodeDisabled(input: {
  root: string;
  chatContextKind: ChatContextKind;
}): boolean {
  if (input.chatContextKind !== "workspace" || input.root === CHAT_HTTP_CONTEXT_ID) {
    return false;
  }
  const snapshot = appState.getSnapshot();
  return !isOpencodeEnabled(snapshot.settings.opencode);
}

export function shouldUseWorkspaceAgentBackend(input: {
  root: string;
  chatContextKind: ChatContextKind;
}): boolean {
  if (input.chatContextKind !== "workspace" || input.root === CHAT_HTTP_CONTEXT_ID) {
    return false;
  }
  const snapshot = appState.getSnapshot();
  if (!isOpencodeEnabled(snapshot.settings.opencode)) {
    return false;
  }
  const activeContextId = snapshot.contexts.activeContextId;
  return isWorkspaceContextId(activeContextId);
}

function noActiveChatTargetMessage(chatContextKind: ChatContextKind): string {
  return chatContextKind === "chat-http"
    ? "Select or create a chat to send messages."
    : "Could not resolve an active session.";
}

function resolveActiveSessionIdForSend(
  sessionId: string | undefined,
  chatContextKind: ChatContextKind,
): string | null {
  const resolved = sessionId ?? chatStore.getActiveSessionId();
  if (resolved) {
    return resolved;
  }
  if (chatContextKind !== "chat-http") {
    return null;
  }
  return chatStore.createDraftSession();
}

export function resolveSendTarget(
  action: "send" | "retry",
  sessionId?: string,
  options?: ChatSendContextOptions,
): ChatSendTargetFailure | ChatSendTargetSuccess {
  const root = chatStore.getActiveChatScopeKey();
  if (!root) {
    return {
      ok: false,
      reason: "no_workspace",
      message: noChatScopeMessage(action),
    };
  }
  const chatContextKind = resolveChatContextKind(root, options);
  const activeSessionId = resolveActiveSessionIdForSend(sessionId, chatContextKind);
  if (!activeSessionId) {
    return {
      ok: false,
      reason: "no_session",
      message: noActiveChatTargetMessage(chatContextKind),
    };
  }
  return { ok: true, root, chatContextKind, activeSessionId };
}

export function beginTurn(activeSessionId: string): string | null {
  const turnId = `turn-${Date.now()}`;
  if (!chatStore.beginTurn(turnId, activeSessionId)) {
    return null;
  }
  return turnId;
}

export async function validateOpencodeBackendSend(
  root: string,
  activeSessionId: string,
): Promise<OpencodeBackendSendValidation | ProviderSendValidationFailure> {
  const workspaceAccess = await ensureWorkspaceReadAccess(root);
  if (workspaceAccess !== "ready") {
    return {
      ok: false,
      reason: "preflight",
      message: WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
    };
  }
  const preferredModelId = chatStore.getMetadata(activeSessionId)?.selectedModelId?.trim() ?? null;
  const catalogModelId = resolveOpencodeModelFallback(root, preferredModelId);
  const modelId = catalogModelId ?? preferredModelId ?? "";
  return { ok: true, modelId };
}

export function getLastRetryError(activeSessionId: string): ChatTurnError | null {
  return chatStore.getRuntimeState(activeSessionId).lastError;
}

export async function validateProviderSend(
  activeSessionId: string,
  options?: ChatSendContextOptions,
): Promise<ProviderSendValidationFailure | ProviderSendValidationSuccess> {
  const root = chatStore.getActiveChatScopeKey();
  if (!root) {
    return {
      ok: false,
      reason: "no_workspace",
      message: noChatScopeMessage("send"),
    };
  }
  const chatContextKind = resolveChatContextKind(root, options);
  const providerId = chatStore.getActiveChatProvider(activeSessionId);
  const appSettings = appState.getSnapshot().settings;
  const resolvedConnection =
    providerId === "http"
      ? resolveHttpConnection(
          appSettings.providerSettings,
          appSettings.providerApiKeys,
          chatStore.getMetadata(activeSessionId)?.connectionId,
        )
      : null;
  if (providerId === "http" && !chatStore.getMetadata(activeSessionId)?.connectionId) {
    const defaultConnectionId = resolvedConnection?.connection.id;
    if (defaultConnectionId) {
      chatStore.updateThreadMetadata({ connectionId: defaultConnectionId }, undefined, activeSessionId);
    }
  }
  if (isDebugProviderSendBlocked(providerId, appSettings.providerSettings)) {
    return {
      ok: false,
      reason: "debug_disabled",
      message: getDebugProviderSendBlockHint(providerId),
    };
  }
  if (
    isHttpProviderSendBlocked(
      providerId,
      resolvedConnection?.connection ?? appSettings.providerSettings.http,
      resolvedConnection?.apiKey ?? "",
    )
  ) {
    return {
      ok: false,
      reason: "http_not_configured",
      message: getHttpProviderMissingConfigMessage(),
    };
  }

  const thread = chatStore.getActiveThreadSnapshot(activeSessionId);
  const catalogContext = {
    providerSettings: appSettings.providerSettings,
    connectionId: resolvedConnection?.connection.id ?? chatStore.getMetadata(activeSessionId)?.connectionId,
  };
  const modelId = resolveComposerModelId({
    thread,
    providerId,
    providerSettings: appSettings.providerSettings,
    providerModelCatalogs: appSettings.providerModelCatalogs,
    connectionId: catalogContext.connectionId,
  });
  const localModelValidation = validateLocalModelSelection(
    appSettings.providerModelCatalogs,
    providerId,
    modelId,
    catalogContext,
  );
  if (!localModelValidation.ok) {
    return {
      ok: false,
      reason: "invalid_model",
      message: `${localModelValidation.message} ${localModelValidation.recoveryHint}`,
    };
  }

  const provider = getChatProvider(providerId);
  if (!provider) {
    return {
      ok: false,
      reason: "provider_unavailable",
      message: PROVIDER_UNAVAILABLE_MESSAGE,
    };
  }

  return {
    ok: true,
    provider,
    accessStatus: "unknown" as WorkspaceAccessStatus,
    modelId: localModelValidation.modelId,
    connectionId: resolvedConnection?.connection.id,
  };
}

export async function executeProviderTurn(params: {
  root: string;
  chatContextKind: ChatContextKind;
  activeSessionId: string;
  turnId: string;
  provider?: ChatProvider;
  accessStatus?: WorkspaceAccessStatus;
  modelId: string;
  connectionId?: string;
  previousError?: ChatTurnError | null;
  context?: WorkspaceAgentSendContext;
}): Promise<SendChatMessageResult> {
  const { root, chatContextKind, activeSessionId, turnId, modelId, connectionId, previousError } =
    params;
  if (shouldUseWorkspaceAgentBackend({ root, chatContextKind })) {
    return executeWorkspaceAgentBackendTurn(params);
  }
  const provider = params.provider;
  const accessStatus = params.accessStatus ?? "unknown";
  if (!provider) {
    abortTurn(activeSessionId, root);
    return {
      ok: false,
      reason: "provider_unavailable",
      message: PROVIDER_UNAVAILABLE_MESSAGE,
    };
  }
  const abortController = new AbortController();
  const thread = chatStore.getActiveThreadSnapshot(activeSessionId);
  if (!thread) {
    abortTurn(activeSessionId, root);
    return {
      ok: false,
      reason: "append_failed",
      message: "Could not prepare the active thread for generation.",
    };
  }

  if (previousError) {
    chatStore.appendMessage(createRetryFailureNote(turnId, previousError), {
      sessionId: activeSessionId,
      skipCompaction: true,
    });
  }

  const request: ProviderSendRequest = {
    payload: buildThreadProviderRequest(thread, root, appState.getSnapshot().settings, chatContextKind),
    modelId,
    connectionId,
    turnKey: turnId,
    accessStatus,
    signal: abortController.signal,
  };
  logChatProviderPayload({
    turnId,
    providerId: chatStore.getActiveChatProvider(activeSessionId),
    connectionId,
    modelId,
    payload: request.payload,
  });

  const assistantMessage = createAssistantPlaceholder(turnId);
  chatStore.appendMessage(assistantMessage, { sessionId: activeSessionId, skipCompaction: true });
  const usesStreamingProvider = Boolean(provider.streamMessage);
  let hasScheduledStreamingPersistence = false;
  const startedAt = Date.now();
  const providerId = chatStore.getActiveChatProvider(activeSessionId);

  logChatSendStart({
    sessionId: activeSessionId,
    turnId,
    providerId,
    connectionId,
    modelId,
    mode: thread.metadata.mode,
    retry: Boolean(previousError),
  });

  try {
    const finalContent = await streamProviderMessage(provider, request, (_delta, accumulated) => {
      if (!chatStore.isGenerationTurnActive(root, activeSessionId, turnId)) {
        abortController.abort();
        throw new TurnCancelledError();
      }
      chatStore.updateMessageContent(assistantMessage.id, accumulated, activeSessionId, root);
      if (usesStreamingProvider && !hasScheduledStreamingPersistence) {
        hasScheduledStreamingPersistence = true;
        persistSessionThreadOnce(root, activeSessionId);
      }
    });
    assertTurnStillActive(root, activeSessionId, turnId);
    chatStore.updateMessageContent(assistantMessage.id, finalContent, activeSessionId, root);
    chatStore.compactActiveThread(activeSessionId);
    chatStore.completeTurn(activeSessionId, root);
    persistSessionThreadOnce(root, activeSessionId);
    logChatSendComplete({
      sessionId: activeSessionId,
      turnId,
      providerId,
      connectionId,
      modelId,
      durationMs: Date.now() - startedAt,
      contentLength: finalContent.length,
    });
    return { ok: true, turnId, assistantMessageId: assistantMessage.id, sessionId: activeSessionId };
  } catch (error) {
    if (isTurnCancelledError(error)) {
      logChatSendFailed({
        sessionId: activeSessionId,
        turnId,
        providerId,
        connectionId,
        modelId,
        durationMs: Date.now() - startedAt,
        reason: "turn cancelled",
        cancelled: true,
      });
      return { ok: false, reason: "generating", message: "Response was cancelled." };
    }
    chatStore.removeMessage(assistantMessage.id, activeSessionId, root);
    if (previousError) {
      chatStore.removeMessage(`retry-note-${turnId}`, activeSessionId, root);
    }
    const message = isChatProviderError(error)
      ? error.userMessage
      : sanitizeUnexpectedProviderError(error);
    chatStore.failTurn({ message, code: "provider_error" }, turnId, activeSessionId, root);
    persistSessionThreadOnce(root, activeSessionId);
    logChatSendFailed({
      sessionId: activeSessionId,
      turnId,
      providerId,
      connectionId,
      modelId,
      durationMs: Date.now() - startedAt,
      reason: message,
    });
    return { ok: false, reason: "provider_error", message };
  }
}

function toWorkspaceBackendErrorMessage(error: unknown): string {
  if (error instanceof WorkspaceAgentBackendError) {
    if (error.code === "authFailure") {
      return "OpenCode authentication failed. Check OpenCode settings and retry.";
    }
    if (error.code === "invalidDirectory") {
      return "OpenCode rejected this workspace directory. Reopen the workspace and retry.";
    }
    if (error.code === "serverUnavailable") {
      return "OpenCode server is unavailable. Check sidecar/server health and retry.";
    }
    if (error.code === "notFound") {
      return "OpenCode session was not found. Retry to start a new session.";
    }
    return error.message.trim() || "OpenCode request failed.";
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return "OpenCode request failed.";
}

async function ensureWorkspaceAgentSessionId(input: {
  root: string;
  activeSessionId: string;
  modelId: string;
  providerId?: string;
}): Promise<{ backend: ReturnType<typeof createWorkspaceAgentBackend>; opencodeSessionId: string }> {
  const backend = createWorkspaceAgentBackend("opencode", {
    resolveRuntimeConfig: async () => {
      const { mode, baseUrl, sidecarPort } = appState.getSnapshot().settings.opencode;
      return { mode, baseUrl, sidecarPort };
    },
  });
  const existingLink = chatStore.getSessionLink(input.activeSessionId, input.root);
  let opencodeSessionId = existingLink?.opencodeSessionId?.trim() ?? "";
  if (opencodeSessionId) {
    const existingSession = await backend.getSession({
      workspaceRootPath: input.root,
      sessionId: opencodeSessionId,
    });
    if (!existingSession) {
      opencodeSessionId = "";
    }
  }
  if (!opencodeSessionId) {
    const title = chatStore.getSessionTitle(input.activeSessionId) ?? undefined;
    const createdSession = await backend.createSession({
      workspaceRootPath: input.root,
      title,
    });
    opencodeSessionId = createdSession.id;
  }
  chatStore.setSessionLink(
    input.activeSessionId,
    {
      opencodeSessionId,
      opencodeModelId: input.modelId.trim() ? input.modelId : undefined,
      opencodeProviderId: input.providerId?.trim() || undefined,
    },
    input.root,
  );
  return { backend, opencodeSessionId };
}

async function executeWorkspaceAgentBackendTurn(params: {
  root: string;
  chatContextKind: ChatContextKind;
  activeSessionId: string;
  turnId: string;
  provider?: ChatProvider;
  accessStatus?: WorkspaceAccessStatus;
  modelId: string;
  connectionId?: string;
  previousError?: ChatTurnError | null;
  context?: WorkspaceAgentSendContext;
}): Promise<SendChatMessageResult> {
  const { root, activeSessionId, turnId, previousError } = params;
  const thread = chatStore.getActiveThreadSnapshot(activeSessionId);
  if (!thread) {
    abortTurn(activeSessionId, root);
    return {
      ok: false,
      reason: "append_failed",
      message: "Could not prepare the active thread for generation.",
    };
  }

  if (previousError) {
    chatStore.appendMessage(createRetryFailureNote(turnId, previousError), {
      sessionId: activeSessionId,
      skipCompaction: true,
    });
  }

  const userMessage = findLastUserMessage(thread.messages);
  if (!userMessage) {
    abortTurn(activeSessionId, root);
    if (previousError) {
      chatStore.removeMessage(`retry-note-${turnId}`, activeSessionId, root);
    }
    return {
      ok: false,
      reason: "append_failed",
      message: "Could not find a user message to send.",
    };
  }

  const assistantMessage = createAssistantPlaceholder(turnId);
  chatStore.appendMessage(assistantMessage, { sessionId: activeSessionId, skipCompaction: true });
  let hasScheduledStreamingPersistence = false;
  let backend: ReturnType<typeof createWorkspaceAgentBackend> | null = null;
  let opencodeSessionId: string | null = null;

  try {
    // M13.5 — lazy sidecar. The Send path is the primary spawn trigger; the
    // ensure call may take a few hundred ms (port check + process spawn) but
    // returns immediately from the Rust IPC perspective. Backend methods
    // below then proceed against the (now-running) sidecar.
    const settings = appState.getSnapshot().settings;
    if (settings.opencode.enabled && settings.opencode.mode === "sidecar") {
      const ensured = await ensureOpencodeSidecar({
        intent: "send",
        directory: root,
        port: settings.opencode.sidecarPort,
      });
      if (!ensured || ensured.status.health === "error") {
        throw new WorkspaceAgentBackendError({
          code: "serverUnavailable",
          message:
            ensured?.status.lastError?.message ??
            "Failed to start OpenCode sidecar.",
        });
      }
    }
    const threadMetadata = chatStore.getMetadata(activeSessionId);
    const modelFromThread = threadMetadata?.selectedModelId?.trim() ?? "";
    const modelId = modelFromThread || params.modelId;
    const providerId = threadMetadata?.opencodeProviderId?.trim() || undefined;
    // OpenCode agent (persona) for this workspace session (e.g. plan, build).
    const opencodeAgentId = threadMetadata?.opencodeAgentId?.trim() || undefined;
    const resolved = await ensureWorkspaceAgentSessionId({
      root,
      activeSessionId,
      modelId,
      providerId,
    });
    backend = resolved.backend;
    opencodeSessionId = resolved.opencodeSessionId;
    const run = await backend.send({
      prompt: userMessage.content,
      workspaceRootPath: root,
      sessionId: opencodeSessionId,
      model: modelId || undefined,
      agent: opencodeAgentId,
      provider: providerId,
      ...(params.context ? { context: params.context } : {}),
    });

    let accumulated = "";
    let toolCalls: ToolCallRecord[] = [];
    // Live-stream structured parts (M8-T1): reasoning / subtask / step parts
    // accumulate on the active assistant message as the corresponding stream
    // events arrive, so they render during the turn — not only after M1-T3
    // `session.messages` hydration on tab reopen.
    let parts: ChatMessagePart[] = [];
    let hasFlushedParts = false;
    const flushParts = (): void => {
      if (parts.length === 0) {
        return;
      }
      chatStore.updateMessageParts(assistantMessage.id, parts, activeSessionId, root);
    };
    for await (const event of backend.streamEvents({
      workspaceRootPath: root,
      sessionId: run.sessionId,
    })) {
      if (!chatStore.isGenerationTurnActive(root, activeSessionId, turnId)) {
        throw new TurnCancelledError();
      }
      if (event.type === "message.delta") {
        accumulated += event.delta;
        chatStore.updateMessageContent(assistantMessage.id, accumulated, activeSessionId, root);
        if (!hasScheduledStreamingPersistence) {
          hasScheduledStreamingPersistence = true;
          persistSessionThreadOnce(root, activeSessionId);
        }
        continue;
      }
      if (event.type === "message.completed") {
        accumulated = event.message || accumulated;
        chatStore.updateMessageContent(assistantMessage.id, accumulated, activeSessionId, root);
        // Flush the accumulated structured parts once on completion so the
        // final message carries them idempotently (no end-of-turn
        // `listMessages` re-hydration — the live path is the single source).
        if (!hasFlushedParts) {
          hasFlushedParts = true;
          flushParts();
        }
        continue;
      }
      if (event.type === "reasoning.delta") {
        parts = applyReasoningDelta(parts, event);
        flushParts();
        continue;
      }
      if (event.type === "reasoning.ended") {
        parts = applyReasoningEnded(parts, event);
        flushParts();
        continue;
      }
      if (event.type === "subtask.started") {
        parts = applySubtaskStarted(parts, event);
        flushParts();
        continue;
      }
      if (event.type === "step.started") {
        parts = applyStepStarted(parts, event);
        flushParts();
        continue;
      }
      if (event.type === "step.finished") {
        parts = applyStepFinished(parts, event);
        flushParts();
        continue;
      }
      if (event.type === "step.failed") {
        parts = applyStepFailed(parts, event);
        flushParts();
        continue;
      }
      if (event.type === "tool.started") {
        toolCalls = applyToolStarted(toolCalls, event);
        chatStore.updateMessageToolCalls(assistantMessage.id, toolCalls, activeSessionId, root);
        continue;
      }
      if (event.type === "tool.completed") {
        toolCalls = applyToolCompleted(toolCalls, event);
        chatStore.updateMessageToolCalls(assistantMessage.id, toolCalls, activeSessionId, root);
        continue;
      }
      if (event.type === "tool.progress") {
        toolCalls = applyToolProgress(toolCalls, event);
        chatStore.updateMessageToolCalls(assistantMessage.id, toolCalls, activeSessionId, root);
        continue;
      }
      if (event.type === "run.failed") {
        throw new Error(event.message);
      }
      if (event.type === "permission.requested") {
        assertTurnStillActive(root, activeSessionId, turnId);
        chatStore.setWaitingForPermission(activeSessionId, true, root);
        const result = await awaitWithTurnCancellation({
          root,
          sessionId: activeSessionId,
          turnId,
          pending: promptPermission({
            permissionId: event.permissionId,
            label: event.label,
            payload: event.payload,
          }),
        }).finally(() => {
          chatStore.setWaitingForPermission(activeSessionId, false, root);
        });
        assertTurnStillActive(root, activeSessionId, turnId);
        try {
          await backend.replyPermission({
            workspaceRootPath: root,
            sessionId: run.sessionId,
            requestId: event.permissionId,
            reply: result.reply as WorkspacePermissionReply,
          });
        } catch (replyError: unknown) {
          if (
            replyError instanceof WorkspaceAgentBackendError &&
            replyError.code === "notFound"
          ) {
            break;
          }
          throw replyError;
        }
        continue;
      }
      if (event.type === "question.requested") {
        assertTurnStillActive(root, activeSessionId, turnId);
        chatStore.setWaitingForQuestion(activeSessionId, true, root);
        const result = await awaitWithTurnCancellation({
          root,
          sessionId: activeSessionId,
          turnId,
          pending: promptQuestion({
            questionId: event.questionId,
            prompt: event.prompt,
            choices: event.choices,
            payload: event.payload,
          }),
        }).finally(() => {
          chatStore.setWaitingForQuestion(activeSessionId, false, root);
        });
        assertTurnStillActive(root, activeSessionId, turnId);
        try {
          if (result.type === "reply") {
            await backend.replyQuestion({
              workspaceRootPath: root,
              sessionId: run.sessionId,
              requestId: event.questionId,
              answers: result.answers,
            });
          } else {
            await backend.rejectQuestion({
              workspaceRootPath: root,
              sessionId: run.sessionId,
              requestId: event.questionId,
            });
          }
        } catch (replyError: unknown) {
          if (
            replyError instanceof WorkspaceAgentBackendError &&
            replyError.code === "notFound"
          ) {
            break;
          }
          throw replyError;
        }
        continue;
      }
    }

    assertTurnStillActive(root, activeSessionId, turnId);
    chatStore.updateMessageContent(assistantMessage.id, accumulated, activeSessionId, root);
    // Final idempotent flush for turns that ended without an explicit
    // `message.completed` (e.g. `run.completed` after the last delta) but that
    // still accumulated structured parts mid-stream.
    if (!hasFlushedParts) {
      hasFlushedParts = true;
      flushParts();
    }
    chatStore.compactActiveThread(activeSessionId);
    chatStore.completeTurn(activeSessionId, root);
    persistSessionThreadOnce(root, activeSessionId);
    return { ok: true, turnId, assistantMessageId: assistantMessage.id, sessionId: activeSessionId };
  } catch (error) {
    if (isTurnCancelledError(error)) {
      if (backend && opencodeSessionId) {
        await abortWorkspaceBackendSession({
          root,
          activeSessionId,
          backend,
        });
      }
      return { ok: false, reason: "generating", message: "Response was cancelled." };
    }
    chatStore.removeMessage(assistantMessage.id, activeSessionId, root);
    if (previousError) {
      chatStore.removeMessage(`retry-note-${turnId}`, activeSessionId, root);
    }
    const message = toWorkspaceBackendErrorMessage(error);
    chatStore.failTurn({ message, code: "provider_error" }, turnId, activeSessionId, root);
    persistSessionThreadOnce(root, activeSessionId);
    return { ok: false, reason: "provider_error", message };
  }
}
