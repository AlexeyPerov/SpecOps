import type { ChatMessage } from "../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import { appState } from "../state/appState";
import { chatStore, type ChatTurnError } from "../state/chatStore";
import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";
import { buildThreadProviderRequest } from "./modes/prompt";
import {
  formatRetryFailureNote,
  PROVIDER_UNAVAILABLE_MESSAGE,
  sanitizeUnexpectedProviderError,
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
import type { WorkspaceAccessStatus } from "./capabilities";
import {
  logChatProviderPayload,
  logChatSendComplete,
  logChatSendFailed,
  logChatSendStart,
} from "./chatDiagnostics";

export type SendChatMessageFailureReason =
  | "empty"
  | "no_workspace"
  | "no_agent"
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
  agentId: string;
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

type ChatSendTargetFailure = {
  ok: false;
  reason: Extract<SendChatMessageFailureReason, "no_workspace" | "no_agent">;
  message: string;
};

type ChatSendTargetSuccess = {
  ok: true;
  root: string;
  chatContextKind: ChatContextKind;
  activeAgentId: string;
};

export type ChatContextKind = "workspace" | "chat-http";

export interface ChatSendContextOptions {
  chatContextKind?: ChatContextKind;
}

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

export function persistAgentThreadOnce(scopeKey: string, agentId: string): void {
  const thread = chatStore.getWorkspaceAgentsState(scopeKey)?.threadsByAgentId[agentId] ?? null;
  if (!thread || !thread.messages.some((message) => message.role === "user")) {
    return;
  }
  scheduleAgentThreadFilePersistence(scopeKey, agentId, {
    version: 1,
    thread,
  });
}

export function abortTurn(agentId: string, workspaceRoot?: string | null): void {
  chatStore.completeTurn(agentId, workspaceRoot);
}

function assertTurnStillActive(root: string, agentId: string, turnId: string): void {
  if (!chatStore.isGenerationTurnActive(root, agentId, turnId)) {
    throw new TurnCancelledError();
  }
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

function noActiveChatTargetMessage(chatContextKind: ChatContextKind): string {
  return chatContextKind === "chat-http"
    ? "Select or create a chat to send messages."
    : "Could not resolve an active agent.";
}

function resolveActiveAgentIdForSend(
  agentId: string | undefined,
  chatContextKind: ChatContextKind,
): string | null {
  const resolved = agentId ?? chatStore.getActiveAgentId();
  if (resolved) {
    return resolved;
  }
  if (chatContextKind !== "chat-http") {
    return null;
  }
  return chatStore.createDraftAgent();
}

export function resolveSendTarget(
  action: "send" | "retry",
  agentId?: string,
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
  const activeAgentId = resolveActiveAgentIdForSend(agentId, chatContextKind);
  if (!activeAgentId) {
    return {
      ok: false,
      reason: "no_agent",
      message: noActiveChatTargetMessage(chatContextKind),
    };
  }
  return { ok: true, root, chatContextKind, activeAgentId };
}

export function beginTurn(activeAgentId: string): string | null {
  const turnId = `turn-${Date.now()}`;
  if (!chatStore.beginTurn(turnId, activeAgentId)) {
    return null;
  }
  return turnId;
}

export function getLastRetryError(activeAgentId: string): ChatTurnError | null {
  return chatStore.getRuntimeState(activeAgentId).lastError;
}

export async function validateProviderSend(
  activeAgentId: string,
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
  const providerId = chatStore.getActiveChatProvider(activeAgentId);
  const appSettings = appState.getSnapshot().settings;
  const resolvedConnection =
    providerId === "http"
      ? resolveHttpConnection(
          appSettings.providerSettings,
          appSettings.providerApiKeys,
          chatStore.getMetadata(activeAgentId)?.connectionId,
        )
      : null;
  if (providerId === "http" && !chatStore.getMetadata(activeAgentId)?.connectionId) {
    const defaultConnectionId = resolvedConnection?.connection.id;
    if (defaultConnectionId) {
      chatStore.updateThreadMetadata({ connectionId: defaultConnectionId }, undefined, activeAgentId);
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

  const thread = chatStore.getActiveThreadSnapshot(activeAgentId);
  const catalogContext = {
    providerSettings: appSettings.providerSettings,
    connectionId: resolvedConnection?.connection.id ?? chatStore.getMetadata(activeAgentId)?.connectionId,
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

  let accessStatus: WorkspaceAccessStatus = "unknown";
  if (chatContextKind === "workspace") {
    const accessState = await chatStore.runAccessPreflight();
    if (accessState.status !== "ready") {
      return {
        ok: false,
        reason: "preflight",
        message: accessState.message,
      };
    }
    accessStatus = accessState.status;
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
    accessStatus,
    modelId: localModelValidation.modelId,
    connectionId: resolvedConnection?.connection.id,
  };
}

export async function executeProviderTurn(params: {
  root: string;
  chatContextKind: ChatContextKind;
  activeAgentId: string;
  turnId: string;
  provider: ChatProvider;
  accessStatus: WorkspaceAccessStatus;
  modelId: string;
  connectionId?: string;
  previousError?: ChatTurnError | null;
}): Promise<SendChatMessageResult> {
  const { root, chatContextKind, activeAgentId, turnId, provider, accessStatus, modelId, connectionId, previousError } =
    params;
  const abortController = new AbortController();
  const thread = chatStore.getActiveThreadSnapshot(activeAgentId);
  if (!thread) {
    abortTurn(activeAgentId, root);
    return {
      ok: false,
      reason: "append_failed",
      message: "Could not prepare the active thread for generation.",
    };
  }

  if (previousError) {
    chatStore.appendMessage(createRetryFailureNote(turnId, previousError), {
      agentId: activeAgentId,
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
    providerId: chatStore.getActiveChatProvider(activeAgentId),
    connectionId,
    modelId,
    payload: request.payload,
  });

  const assistantMessage = createAssistantPlaceholder(turnId);
  chatStore.appendMessage(assistantMessage, { agentId: activeAgentId, skipCompaction: true });
  const usesStreamingProvider = Boolean(provider.streamMessage);
  let hasScheduledStreamingPersistence = false;
  const startedAt = Date.now();
  const providerId = chatStore.getActiveChatProvider(activeAgentId);

  logChatSendStart({
    agentId: activeAgentId,
    turnId,
    providerId,
    connectionId,
    modelId,
    mode: thread.metadata.mode,
    retry: Boolean(previousError),
  });

  try {
    const finalContent = await streamProviderMessage(provider, request, (_delta, accumulated) => {
      if (!chatStore.isGenerationTurnActive(root, activeAgentId, turnId)) {
        abortController.abort();
        throw new TurnCancelledError();
      }
      chatStore.updateMessageContent(assistantMessage.id, accumulated, activeAgentId, root);
      if (usesStreamingProvider && !hasScheduledStreamingPersistence) {
        hasScheduledStreamingPersistence = true;
        persistAgentThreadOnce(root, activeAgentId);
      }
    });
    assertTurnStillActive(root, activeAgentId, turnId);
    chatStore.updateMessageContent(assistantMessage.id, finalContent, activeAgentId, root);
    chatStore.compactActiveThread(activeAgentId);
    chatStore.completeTurn(activeAgentId, root);
    persistAgentThreadOnce(root, activeAgentId);
    logChatSendComplete({
      agentId: activeAgentId,
      turnId,
      providerId,
      connectionId,
      modelId,
      durationMs: Date.now() - startedAt,
      contentLength: finalContent.length,
    });
    return { ok: true, turnId, assistantMessageId: assistantMessage.id, agentId: activeAgentId };
  } catch (error) {
    if (isTurnCancelledError(error)) {
      logChatSendFailed({
        agentId: activeAgentId,
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
    chatStore.removeMessage(assistantMessage.id, activeAgentId, root);
    if (previousError) {
      chatStore.removeMessage(`retry-note-${turnId}`, activeAgentId, root);
    }
    const message = isChatProviderError(error)
      ? error.userMessage
      : sanitizeUnexpectedProviderError(error);
    chatStore.failTurn({ message, code: "provider_error" }, turnId, activeAgentId, root);
    persistAgentThreadOnce(root, activeAgentId);
    logChatSendFailed({
      agentId: activeAgentId,
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
