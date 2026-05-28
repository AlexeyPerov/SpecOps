import type { ChatMessage } from "../domain/contracts";
import { buildThreadProviderRequest } from "./modes/prompt";
import {
  getDebugProviderSendBlockHint,
  isDebugProviderSendBlocked,
} from "./providers/debugProviderSettings";
import { getChatProvider } from "./providers/registry";
import type { ProviderSendRequest } from "./providers/types";
import { appState } from "../state/appState";
import { chatStore } from "../state/chatStore";
import {
  INTERIM_WORKSPACE_AGENT_ID,
  scheduleAgentThreadFilePersistence,
} from "../services/chatPersistence";
import { isChatProviderError, streamProviderMessage } from "./chatSend";

export type SendChatMessageFailureReason =
  | "empty"
  | "no_workspace"
  | "generating"
  | "preflight"
  | "debug_disabled"
  | "provider_unavailable"
  | "append_failed"
  | "provider_error";

export type SendChatMessageResult =
  | { ok: true; turnId: string; assistantMessageId: string }
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

function persistActiveThreadOnce(): void {
  const root = chatStore.getActiveWorkspaceRoot();
  if (!root) {
    return;
  }
  const thread = chatStore.getActiveThreadSnapshot();
  if (!root || !thread) {
    return;
  }
  scheduleAgentThreadFilePersistence(root, INTERIM_WORKSPACE_AGENT_ID, {
    version: 1,
    thread,
  });
}

function abortTurn(): void {
  chatStore.completeTurn();
}

export async function sendChatMessage(content: string): Promise<SendChatMessageResult> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty", message: "Message cannot be empty." };
  }

  const root = chatStore.getActiveWorkspaceRoot();
  if (!root) {
    return { ok: false, reason: "no_workspace", message: "Open a workspace to send chat messages." };
  }

  if (chatStore.getRuntimeState().isGenerating) {
    return {
      ok: false,
      reason: "generating",
      message: "Wait for the current response to finish before sending another message.",
    };
  }

  const turnId = `turn-${Date.now()}`;
  if (!chatStore.beginTurn(turnId)) {
    return {
      ok: false,
      reason: "generating",
      message: "Another response is already in progress.",
    };
  }

  const accessState = await chatStore.runAccessPreflight();
  if (accessState.status !== "ready") {
    abortTurn();
    return {
      ok: false,
      reason: "preflight",
      message: accessState.message,
    };
  }

  const providerId = chatStore.getActiveChatProvider();
  const debugSettings = appState.getSnapshot().settings.debugProvider;
  if (isDebugProviderSendBlocked(providerId, debugSettings)) {
    abortTurn();
    return {
      ok: false,
      reason: "debug_disabled",
      message: getDebugProviderSendBlockHint(),
    };
  }

  const provider = getChatProvider(providerId);
  if (!provider) {
    abortTurn();
    return {
      ok: false,
      reason: "provider_unavailable",
      message: "The selected provider is not available yet.",
    };
  }

  const userMessage = createUserMessage(trimmed);
  if (!chatStore.appendMessage(userMessage)) {
    abortTurn();
    return {
      ok: false,
      reason: "append_failed",
      message: "Could not append your message to the active thread.",
    };
  }

  const threadAfterUser = chatStore.getActiveThreadSnapshot();
  if (!threadAfterUser) {
    abortTurn();
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
  chatStore.appendMessage(assistantMessage, { skipCompaction: true });

  try {
    const finalContent = await streamProviderMessage(provider, request, (_delta, accumulated) => {
      chatStore.updateMessageContent(assistantMessage.id, accumulated);
    });
    chatStore.updateMessageContent(assistantMessage.id, finalContent);
    chatStore.compactActiveThread();
    chatStore.completeTurn();
    persistActiveThreadOnce();
    return { ok: true, turnId, assistantMessageId: assistantMessage.id };
  } catch (error) {
    chatStore.removeMessage(assistantMessage.id);
    const message = isChatProviderError(error)
      ? error.userMessage
      : error instanceof Error
        ? error.message
        : "Failed to generate a response.";
    chatStore.failTurn({ message, code: "provider_error" }, turnId);
    persistActiveThreadOnce();
    return { ok: false, reason: "provider_error", message };
  }
}
