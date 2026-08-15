import type { ChatMessage } from "../domain/contracts";
import { appState } from "../state/appState";
import { chatStore, type ChatTurnError } from "../state/chatStore";
import { scheduleSessionThreadFilePersistence } from "../services/chatPersistence";
import {
  DEFAULT_SESSION_RUNTIME_ID,
  ensureAgentHostStarted,
  getAgentHostClient,
} from "../services/agentHostRuntime";
import type { AgentHostClientError } from "../session/host/agentHostClient";
import type { NativeSessionRef } from "../session/adapter";
import type { PermissionReply } from "../session/events";
import { asNativeSessionId, asSpecOpsTurnId, isAgentRuntimeId } from "../session";
import type { SessionBinding } from "../state/chatStore/sessions";
import { foldSessionEvent, initialTurnFoldState } from "../session/host/hostTurnReducer";
import {
  formatRetryFailureNote,
  PROVIDER_REQUEST_FAILURE_RECOVERY,
  WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
} from "./chatErrorCopy";
import { promptPermission } from "../services/permissionPrompt";
import { promptQuestion } from "../services/questionPrompt";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";

export type SendChatMessageFailureReason =
  | "empty"
  | "no_workspace"
  | "no_session"
  | "generating"
  | "preflight"
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

/**
 * Runtime-neutral per-send context assembled by the composer (mentions +
 * attachments) and forwarded with the host `turn.send` request.
 */
export interface ChatSendContextAttachment {
  mime: string;
  filename?: string;
  url: string;
}

export interface ChatSendContext {
  /** File paths mentioned via `@file:…`. */
  filePaths?: string[];
  /** Agent names mentioned via `@agent:…`. */
  agentNames?: string[];
  /** File attachments (drag-and-drop / file picker). */
  attachments?: ChatSendContextAttachment[];
}

export interface ChatSendContextOptions {
  /** Composer-assembled mentions / attachments. */
  context?: ChatSendContext;
  /** Delivery mode for prompts sent while a turn is running. */
  queueMode?: ChatQueueMode;
}

/** How a prompt sent while a turn is running is handled. */
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

function toNativeRef(binding: SessionBinding): NativeSessionRef {
  return {
    runtimeId: binding.runtimeId,
    nativeSessionId: asNativeSessionId(binding.nativeSessionId),
    ...(binding.modelId ? { modelId: binding.modelId } : {}),
    ...(binding.modeId ? { modeId: binding.modeId } : {}),
  };
}

/**
 * Abort the running turn for a session: clears the local turn runtime state
 * (which also drops the assistant placeholder) and asks the host to cancel the
 * native turn. The send loop observes the cancellation (turn event stream ends
 * with `turn.cancelled`) and returns its cancelled result.
 */
export function abortTurn(sessionId: string, workspaceRoot?: string | null): void {
  const root = workspaceRoot ?? chatStore.getActiveChatScopeKey();
  if (!root) {
    return;
  }
  const runtime = chatStore.getRuntimeState(sessionId, root);
  const turnId = runtime.activeTurnId;
  chatStore.cancelSessionGeneration(root, sessionId);
  if (!turnId) {
    return;
  }
  const binding = chatStore.getSessionLink(sessionId, root);
  if (!binding) {
    return;
  }
  void getAgentHostClient()
    .cancelTurn({
      native: toNativeRef(binding),
      turnId: asSpecOpsTurnId(turnId),
      reason: "user",
    })
    .catch(() => {
      // Best-effort: the store state is already cleared; a host that already
      // ended the turn (or died) must not surface an error here.
    });
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

export function resolveSendTarget(
  action: "send" | "retry",
  sessionId?: string,
):
  | { ok: false; reason: "no_workspace" | "no_session"; message: string }
  | { ok: true; root: string; activeSessionId: string } {
  const root = chatStore.getActiveChatScopeKey();
  if (!root) {
    return {
      ok: false,
      reason: "no_workspace",
      message:
        action === "retry"
          ? "Open a workspace to retry chat messages."
          : "Open a workspace to send chat messages.",
    };
  }
  const activeSessionId = sessionId ?? chatStore.getActiveSessionId();
  if (!activeSessionId) {
    return {
      ok: false,
      reason: "no_session",
      message: "Could not resolve an active session.",
    };
  }
  return { ok: true, root, activeSessionId };
}

export function beginTurn(activeSessionId: string): string | null {
  const turnId = `turn-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  if (!chatStore.beginTurn(turnId, activeSessionId)) {
    return null;
  }
  return turnId;
}

export interface AgentHostSendValidation {
  ok: true;
  modelId: string;
  modeId: string;
}

/**
 * Preflight a host-backed send: the workspace must be readable and the
 * session's model/mode selection resolves from the thread metadata (selected
 * at creation or via the composer pickers) falling back to the persisted
 * native binding.
 */
export async function validateAgentHostSend(
  root: string,
  activeSessionId: string,
): Promise<AgentHostSendValidation | { ok: false; reason: SendChatMessageFailureReason; message: string }> {
  const workspaceAccess = await ensureWorkspaceReadAccess(root);
  if (workspaceAccess !== "ready") {
    return {
      ok: false,
      reason: "preflight",
      message: WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
    };
  }
  const metadata = chatStore.getMetadata(activeSessionId);
  const binding = chatStore.getSessionLink(activeSessionId, root);
  const modelId = metadata?.selectedModelId?.trim() || binding?.modelId || "";
  const modeId = metadata?.selectedModeId?.trim() || binding?.modeId || "";
  return { ok: true, modelId, modeId };
}

export function getLastRetryError(activeSessionId: string): ChatTurnError | null {
  return chatStore.getRuntimeState(activeSessionId).lastError;
}

/** Maps host-transport and adapter failures onto user-facing copy. */
function toHostTurnErrorMessage(error: unknown): string {
  const hostError = error as Partial<AgentHostClientError> | null;
  if (hostError && typeof hostError.kind === "string") {
    switch (hostError.kind) {
      case "notRunning":
      case "launchFailure":
      case "initializeTimeout":
        return "The agent host could not be started. Retry in a moment.";
      case "crashLoop":
        return "The agent host keeps crashing and was stopped. Restart it before retrying.";
      case "hostExited":
      case "shuttingDown":
        return "The agent host exited unexpectedly. Retry to continue the session.";
      case "protocolVersionMismatch":
        return "The agent host speaks an unsupported protocol version. Update the app.";
      case "requestTimeout":
        return "The runtime took too long to respond. Retry the turn.";
      case "protocol":
      case "io":
      case "nodeMissing":
      case "hostPathMissing":
        return typeof hostError.message === "string" && hostError.message.trim().length > 0
          ? hostError.message.trim()
          : "The agent host request failed.";
    }
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return "The agent request failed.";
}

/** Resolve (or create) the session's native binding through the host. */
async function ensureNativeBinding(input: {
  root: string;
  activeSessionId: string;
  modelId: string;
  modeId: string;
}): Promise<SessionBinding> {
  const { root, activeSessionId, modelId, modeId } = input;
  const client = getAgentHostClient();
  const existing = chatStore.getSessionLink(activeSessionId, root);
  if (existing) {
    // Resume so a host restart mid-session recovers the native session before
    // the next turn (the fake adapter adopts known ids; real adapters reconnect).
    const native = await client.resumeSession({
      native: toNativeRef(existing),
      workspaceRootPath: root,
    });
    const binding: SessionBinding = {
      runtimeId: native.runtimeId,
      nativeSessionId: native.nativeSessionId,
      modelId: modelId || existing.modelId,
      ...(modeId ? { modeId } : existing.modeId ? { modeId: existing.modeId } : {}),
      ...(existing.shareUrl ? { shareUrl: existing.shareUrl } : {}),
      ...(existing.parentSessionId ? { parentSessionId: existing.parentSessionId } : {}),
    };
    chatStore.setSessionLink(activeSessionId, binding, root);
    return binding;
  }
  const metadataRuntimeId = chatStore.getMetadata(activeSessionId)?.runtimeId?.trim() ?? "";
  const runtimeId = isAgentRuntimeId(metadataRuntimeId)
    ? metadataRuntimeId
    : DEFAULT_SESSION_RUNTIME_ID;
  const native = await client.createSession({
    runtimeId,
    workspaceRootPath: root,
    ...(modelId ? { modelId } : {}),
    ...(modeId ? { modeId } : {}),
  });
  const binding: SessionBinding = {
    runtimeId: native.runtimeId,
    nativeSessionId: native.nativeSessionId,
    modelId: native.modelId ?? (modelId || undefined),
    ...(modeId ? { modeId } : native.modeId ? { modeId: native.modeId } : {}),
  };
  chatStore.setSessionLink(activeSessionId, binding, root);
  return binding;
}

export async function executeProviderTurn(params: {
  root: string;
  activeSessionId: string;
  turnId: string;
  modelId?: string;
  modeId?: string;
  previousError?: ChatTurnError | null;
  context?: ChatSendContext;
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

  try {
    // Lazy host start: the send path is the primary spawn trigger. Concurrent
    // sends share one start promise; a failed start clears the cache so the
    // next turn retries.
    await ensureAgentHostStarted();

    const metadata = chatStore.getMetadata(activeSessionId);
    const modelId = metadata?.selectedModelId?.trim() || params.modelId || "";
    const modeId = metadata?.selectedModeId?.trim() || params.modeId || "";
    const binding = await ensureNativeBinding({
      root,
      activeSessionId,
      modelId,
      modeId,
    });
    const native = toNativeRef(binding);
    const client = getAgentHostClient();

    let fold = initialTurnFoldState();
    for await (const event of client.sendTurn({
      turnId: asSpecOpsTurnId(turnId),
      native,
      workspaceRootPath: root,
      prompt: userMessage.content,
      ...(params.context ? { context: params.context as unknown as Record<string, unknown> } : {}),
    })) {
      if (!chatStore.isGenerationTurnActive(root, activeSessionId, turnId)) {
        throw new TurnCancelledError();
      }
      if (event.type === "permission.requested") {
        assertTurnStillActive(root, activeSessionId, turnId);
        chatStore.setWaitingForPermission(activeSessionId, true, root);
        const result = await awaitWithTurnCancellation({
          root,
          sessionId: activeSessionId,
          turnId,
          pending: promptPermission({
            permissionId: event.request.permissionId,
            label: event.request.label,
            payload: event.request.payload,
          }),
        }).finally(() => {
          chatStore.setWaitingForPermission(activeSessionId, false, root);
        });
        assertTurnStillActive(root, activeSessionId, turnId);
        await client.replyPermission({
          native,
          turnId: asSpecOpsTurnId(turnId),
          permissionId: event.request.permissionId,
          reply: result.reply as PermissionReply,
        });
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
            questionId: event.request.questionId,
            prompt: event.request.prompt,
            choices: [...(event.request.choices ?? [])],
            payload: event.request.payload,
          }),
        }).finally(() => {
          chatStore.setWaitingForQuestion(activeSessionId, false, root);
        });
        assertTurnStillActive(root, activeSessionId, turnId);
        if (result.type === "reply") {
          await client.replyQuestion({
            native,
            turnId: asSpecOpsTurnId(turnId),
            questionId: event.request.questionId,
            answer: result.answers.map((choice) => choice.join(", ")).join("\n"),
          });
        } else {
          // Question rejected — cancel the turn (the runtime is blocked on us).
          await client.cancelTurn({
            native,
            turnId: asSpecOpsTurnId(turnId),
            reason: "user",
          });
          throw new TurnCancelledError();
        }
        continue;
      }
      if (event.type === "turn.failed") {
        throw new Error(event.message);
      }
      if (event.type === "turn.cancelled") {
        throw new TurnCancelledError();
      }

      const next = foldSessionEvent(fold, event);
      if (next.content !== fold.content) {
        chatStore.updateMessageContent(assistantMessage.id, next.content, activeSessionId, root);
        if (!hasScheduledStreamingPersistence) {
          hasScheduledStreamingPersistence = true;
          persistSessionThreadOnce(root, activeSessionId);
        }
      }
      if (next.parts !== fold.parts && next.parts.length > 0) {
        chatStore.updateMessageParts(assistantMessage.id, next.parts, activeSessionId, root);
      }
      if (next.toolCalls !== fold.toolCalls && next.toolCalls.length > 0) {
        chatStore.updateMessageToolCalls(assistantMessage.id, next.toolCalls, activeSessionId, root);
      }
      fold = next;
    }

    assertTurnStillActive(root, activeSessionId, turnId);
    chatStore.updateMessageContent(assistantMessage.id, fold.content, activeSessionId, root);
    if (fold.parts.length > 0) {
      chatStore.updateMessageParts(assistantMessage.id, fold.parts, activeSessionId, root);
    }
    if (fold.toolCalls.length > 0) {
      chatStore.updateMessageToolCalls(assistantMessage.id, fold.toolCalls, activeSessionId, root);
    }
    chatStore.compactActiveThread(activeSessionId);
    chatStore.completeTurn(activeSessionId, root);
    persistSessionThreadOnce(root, activeSessionId);
    return { ok: true, turnId, assistantMessageId: assistantMessage.id, sessionId: activeSessionId };
  } catch (error) {
    if (isTurnCancelledError(error)) {
      // Make sure the native turn is cancelled even when the loop noticed the
      // cancellation through the store rather than a host event.
      const binding = chatStore.getSessionLink(activeSessionId, root);
      if (binding) {
        await getAgentHostClient()
          .cancelTurn({
            native: toNativeRef(binding),
            turnId: asSpecOpsTurnId(turnId),
            reason: "user",
          })
          .catch(() => {
            // Already terminal on the host side — nothing to do.
          });
      }
      chatStore.completeTurn(activeSessionId, root);
      return { ok: false, reason: "generating", message: "Response was cancelled." };
    }
    chatStore.removeMessage(assistantMessage.id, activeSessionId, root);
    if (previousError) {
      chatStore.removeMessage(`retry-note-${turnId}`, activeSessionId, root);
    }
    const message = toHostTurnErrorMessage(error);
    chatStore.failTurn({ message, code: "provider_error" }, turnId, activeSessionId, root);
    persistSessionThreadOnce(root, activeSessionId);
    return { ok: false, reason: "provider_error", message };
  }
}
