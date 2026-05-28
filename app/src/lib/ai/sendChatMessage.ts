import type { ChatMessage } from "../domain/contracts";
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
  getGlmProviderMissingConfigMessage,
  isGlmProviderSendBlocked,
} from "./providers/glmProviderSettings";
import { getChatProvider } from "./providers/registry";
import type { ChatProvider, ProviderSendRequest } from "./providers/types";
import { appState } from "../state/appState";
import { chatStore, type ChatTurnError } from "../state/chatStore";
import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";
import { isChatProviderError, streamProviderMessage } from "./chatSend";
import type { WorkspaceAccessStatus } from "../ai/capabilities";

export type SendChatMessageFailureReason =
  | "empty"
  | "no_workspace"
  | "no_agent"
  | "generating"
  | "preflight"
  | "debug_disabled"
  | "glm_not_configured"
  | "provider_unavailable"
  | "append_failed"
  | "provider_error";

export type RetryLastChatTurnFailureReason =
  | SendChatMessageFailureReason
  | "no_failed_turn"
  | "no_user_message";

export type ChatTurnSuccessResult = {
  ok: true;
  turnId: string;
  assistantMessageId: string;
  agentId: string;
};

export type SendChatMessageResult =
  | ChatTurnSuccessResult
  | { ok: false; reason: SendChatMessageFailureReason; message: string };

export type RetryLastChatTurnResult =
  | ChatTurnSuccessResult
  | { ok: false; reason: RetryLastChatTurnFailureReason; message: string };

function createUserMessage(content: string): ChatMessage {
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

function persistAgentThreadOnce(agentId: string): void {
  const root = chatStore.getActiveWorkspaceRoot();
  const thread = chatStore.getActiveThreadSnapshot(agentId);
  if (!root || !thread || !thread.messages.some((message) => message.role === "user")) {
    return;
  }
  scheduleAgentThreadFilePersistence(root, agentId, {
    version: 1,
    thread,
  });
}

function abortTurn(agentId: string): void {
  chatStore.completeTurn(agentId);
}

function findLastUserMessage(messages: ChatMessage[]): ChatMessage | null {
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

type ProviderSendValidationFailure = {
  ok: false;
  reason: SendChatMessageFailureReason;
  message: string;
};

type ProviderSendValidationSuccess = {
  ok: true;
  provider: ChatProvider;
  accessStatus: WorkspaceAccessStatus;
};

async function validateProviderSend(
  activeAgentId: string,
): Promise<ProviderSendValidationFailure | ProviderSendValidationSuccess> {
  const accessState = await chatStore.runAccessPreflight();
  if (accessState.status !== "ready") {
    return {
      ok: false,
      reason: "preflight",
      message: accessState.message,
    };
  }

  const providerId = chatStore.getActiveChatProvider(activeAgentId);
  const appSettings = appState.getSnapshot().settings;
  const debugSettings = appSettings.debugProvider;
  if (isDebugProviderSendBlocked(providerId, debugSettings)) {
    return {
      ok: false,
      reason: "debug_disabled",
      message: getDebugProviderSendBlockHint(),
    };
  }

  if (isGlmProviderSendBlocked(providerId, appSettings.glmProvider, appSettings.glmApiKey)) {
    return {
      ok: false,
      reason: "glm_not_configured",
      message: getGlmProviderMissingConfigMessage(),
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

  return { ok: true, provider, accessStatus: accessState.status };
}

async function executeProviderTurn(params: {
  root: string;
  activeAgentId: string;
  turnId: string;
  provider: ChatProvider;
  accessStatus: WorkspaceAccessStatus;
  previousError?: ChatTurnError | null;
}): Promise<SendChatMessageResult> {
  const { root, activeAgentId, turnId, provider, accessStatus, previousError } = params;

  const thread = chatStore.getActiveThreadSnapshot(activeAgentId);
  if (!thread) {
    abortTurn(activeAgentId);
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
    payload: buildThreadProviderRequest(thread, root),
    turnKey: turnId,
    accessStatus,
  };

  const assistantMessage = createAssistantPlaceholder(turnId);
  chatStore.appendMessage(assistantMessage, { agentId: activeAgentId, skipCompaction: true });

  try {
    const finalContent = await streamProviderMessage(provider, request, (_delta, accumulated) => {
      chatStore.updateMessageContent(assistantMessage.id, accumulated, activeAgentId);
    });
    chatStore.updateMessageContent(assistantMessage.id, finalContent, activeAgentId);
    chatStore.compactActiveThread(activeAgentId);
    chatStore.completeTurn(activeAgentId);
    persistAgentThreadOnce(activeAgentId);
    return { ok: true, turnId, assistantMessageId: assistantMessage.id, agentId: activeAgentId };
  } catch (error) {
    chatStore.removeMessage(assistantMessage.id, activeAgentId);
    if (previousError) {
      chatStore.removeMessage(`retry-note-${turnId}`, activeAgentId);
    }
    const message = isChatProviderError(error)
      ? error.userMessage
      : sanitizeUnexpectedProviderError(error);
    chatStore.failTurn({ message, code: "provider_error" }, turnId, activeAgentId);
    persistAgentThreadOnce(activeAgentId);
    return { ok: false, reason: "provider_error", message };
  }
}

export async function retryLastChatTurn(agentId?: string): Promise<RetryLastChatTurnResult> {
  const root = chatStore.getActiveWorkspaceRoot();
  if (!root) {
    return { ok: false, reason: "no_workspace", message: "Open a workspace to retry chat messages." };
  }

  const activeAgentId = agentId ?? chatStore.getActiveAgentId();
  if (!activeAgentId) {
    return { ok: false, reason: "no_agent", message: "Could not resolve an active agent." };
  }

  if (!chatStore.canRetryLastTurn(activeAgentId)) {
    return {
      ok: false,
      reason: "no_failed_turn",
      message: "There is no failed response to retry.",
    };
  }

  const thread = chatStore.getActiveThreadSnapshot(activeAgentId);
  if (!findLastUserMessage(thread?.messages ?? [])) {
    return {
      ok: false,
      reason: "no_user_message",
      message: "Could not find the last user message to retry.",
    };
  }

  const validation = await validateProviderSend(activeAgentId);
  if (!validation.ok) {
    return validation;
  }

  const previousError = chatStore.getRuntimeState(activeAgentId).lastError;
  const turnId = `turn-${Date.now()}`;
  if (!chatStore.beginTurn(turnId, activeAgentId)) {
    return {
      ok: false,
      reason: "generating",
      message: "Another response is already in progress.",
    };
  }

  return executeProviderTurn({
    root,
    activeAgentId,
    turnId,
    provider: validation.provider,
    accessStatus: validation.accessStatus,
    previousError,
  });
}

export async function sendChatMessage(
  content: string,
  agentId?: string,
): Promise<SendChatMessageResult> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty", message: "Message cannot be empty." };
  }

  const root = chatStore.getActiveWorkspaceRoot();
  if (!root) {
    return { ok: false, reason: "no_workspace", message: "Open a workspace to send chat messages." };
  }

  const activeAgentId = agentId ?? chatStore.getActiveAgentId();
  if (!activeAgentId) {
    return { ok: false, reason: "no_agent", message: "Could not resolve an active agent." };
  }

  const turnId = `turn-${Date.now()}`;
  if (!chatStore.beginTurn(turnId, activeAgentId)) {
    return {
      ok: false,
      reason: "generating",
      message: "Another response is already in progress.",
    };
  }

  const validation = await validateProviderSend(activeAgentId);
  if (!validation.ok) {
    abortTurn(activeAgentId);
    return validation;
  }

  const userMessage = createUserMessage(trimmed);
  if (!chatStore.appendMessage(userMessage, { agentId: activeAgentId })) {
    abortTurn(activeAgentId);
    return {
      ok: false,
      reason: "append_failed",
      message: "Could not append your message to the active thread.",
    };
  }

  return executeProviderTurn({
    root,
    activeAgentId,
    turnId,
    provider: validation.provider,
    accessStatus: validation.accessStatus,
  });
}
