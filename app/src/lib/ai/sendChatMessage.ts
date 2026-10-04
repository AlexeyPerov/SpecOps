import { chatStore } from "../state/chatStore";
import {
  abortTurn,
  beginTurn,
  createUserMessage,
  executeProviderTurn,
  persistSessionThreadOnce,
  resolveSendTarget,
  validateAgentHostSend,
  type ChatSendContextOptions,
  type SendChatMessageResult,
} from "./chatSendPipeline";
import { retryLastChatTurn, type RetryLastChatTurnFailureReason, type RetryLastChatTurnResult } from "./retryChatTurn";
import type { ChatTurnSuccessResult } from "./chatSendPipeline";
import { SESSIONS_DISABLED_MESSAGE } from "./chatErrorCopy";
import { appState } from "../state/appState";

export { retryLastChatTurn };
export type { ChatTurnSuccessResult, RetryLastChatTurnResult, RetryLastChatTurnFailureReason };

export async function sendChatMessage(
  content: string,
  sessionId?: string,
  options?: ChatSendContextOptions,
): Promise<SendChatMessageResult> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty", message: "Message cannot be empty." };
  }

  const target = resolveSendTarget("send", sessionId);
  if (!target.ok) {
    return target;
  }

  const turnId = beginTurn(target.activeSessionId);
  if (!turnId) {
    return {
      ok: false,
      reason: "generating",
      message: "Another response is already in progress.",
    };
  }

  const userMessage = createUserMessage(trimmed);
  if (!chatStore.appendMessage(userMessage, { sessionId: target.activeSessionId })) {
    abortTurn(target.activeSessionId, target.root);
    return {
      ok: false,
      reason: "append_failed",
      message: "Could not append your message to the active thread.",
    };
  }
  persistSessionThreadOnce(target.root, target.activeSessionId);

  // Shared Sessions enablement applies to every host runtime.
  if (!appState.getSnapshot().settings.sessionsEnabled) {
    chatStore.removeMessage(userMessage.id, target.activeSessionId, target.root);
    abortTurn(target.activeSessionId, target.root);
    return { ok: false, reason: "provider_unavailable", message: SESSIONS_DISABLED_MESSAGE };
  }

  const validation = await validateAgentHostSend(target.root, target.activeSessionId);
  if (!validation.ok) {
    chatStore.removeMessage(userMessage.id, target.activeSessionId, target.root);
    abortTurn(target.activeSessionId, target.root);
    return validation;
  }
  return executeProviderTurn({
    root: target.root,
    activeSessionId: target.activeSessionId,
    turnId,
    modelId: validation.modelId,
    modeId: validation.modeId,
    ...(options?.context ? { context: options.context } : {}),
  });
}
