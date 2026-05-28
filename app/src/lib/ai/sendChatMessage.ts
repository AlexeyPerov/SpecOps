import type { ChatMessage } from "../domain/contracts";
import { buildThreadProviderRequest } from "./modes/prompt";
import {
  getDebugProviderSendBlockHint,
  isDebugProviderSendBlocked,
} from "./providers/debugProviderSettings";
import {
  getGlmProviderMissingConfigMessage,
  isGlmProviderSendBlocked,
} from "./providers/glmProviderSettings";
import { getChatProvider } from "./providers/registry";
import type { ProviderSendRequest } from "./providers/types";
import { appState } from "../state/appState";
import { chatStore } from "../state/chatStore";
import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";
import { isChatProviderError, streamProviderMessage } from "./chatSend";

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

export type SendChatMessageResult =
  | { ok: true; turnId: string; assistantMessageId: string; agentId: string }
  | { ok: false; reason: SendChatMessageFailureReason; message: string };

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

  const accessState = await chatStore.runAccessPreflight();
  if (accessState.status !== "ready") {
    abortTurn(activeAgentId);
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
    abortTurn(activeAgentId);
    return {
      ok: false,
      reason: "debug_disabled",
      message: getDebugProviderSendBlockHint(),
    };
  }

  if (isGlmProviderSendBlocked(providerId, appSettings.glmProvider, appSettings.glmApiKey)) {
    abortTurn(activeAgentId);
    return {
      ok: false,
      reason: "glm_not_configured",
      message: getGlmProviderMissingConfigMessage(),
    };
  }

  const provider = getChatProvider(providerId);
  if (!provider) {
    abortTurn(activeAgentId);
    return {
      ok: false,
      reason: "provider_unavailable",
      message: "The selected provider is not available yet.",
    };
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

  const threadAfterUser = chatStore.getActiveThreadSnapshot(activeAgentId);
  if (!threadAfterUser) {
    abortTurn(activeAgentId);
    return {
      ok: false,
      reason: "append_failed",
      message: "Could not prepare the active thread for generation.",
    };
  }

  const request: ProviderSendRequest = {
    payload: buildThreadProviderRequest(threadAfterUser, root),
    turnKey: turnId,
    accessStatus: accessState.status,
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
    const message = isChatProviderError(error)
      ? error.userMessage
      : error instanceof Error
        ? error.message
        : "Failed to generate a response.";
    chatStore.failTurn({ message, code: "provider_error" }, turnId, activeAgentId);
    persistAgentThreadOnce(activeAgentId);
    return { ok: false, reason: "provider_error", message };
  }
}
