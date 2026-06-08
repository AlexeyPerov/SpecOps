import { chatStore } from "../state/chatStore";
import {
  abortTurn,
  beginTurn,
  createUserMessage,
  executeProviderTurn,
  persistAgentThreadOnce,
  resolveSendTarget,
  validateProviderSend,
  type ChatSendContextOptions,
  type SendChatMessageResult,
} from "./chatSendPipeline";
import { retryLastChatTurn, type RetryLastChatTurnFailureReason, type RetryLastChatTurnResult } from "./retryChatTurn";
import type { ChatTurnSuccessResult } from "./chatSendPipeline";

export { retryLastChatTurn };
export type { ChatTurnSuccessResult, RetryLastChatTurnResult, RetryLastChatTurnFailureReason };

export async function sendChatMessage(
  content: string,
  agentId?: string,
  options?: ChatSendContextOptions,
): Promise<SendChatMessageResult> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty", message: "Message cannot be empty." };
  }

  const target = resolveSendTarget("send", agentId, options);
  if (!target.ok) {
    return target;
  }

  const turnId = beginTurn(target.activeAgentId);
  if (!turnId) {
    return {
      ok: false,
      reason: "generating",
      message: "Another response is already in progress.",
    };
  }

  const userMessage = createUserMessage(trimmed);
  if (!chatStore.appendMessage(userMessage, { agentId: target.activeAgentId })) {
    abortTurn(target.activeAgentId, target.root);
    return {
      ok: false,
      reason: "append_failed",
      message: "Could not append your message to the active thread.",
    };
  }
  persistAgentThreadOnce(target.root, target.activeAgentId);

  const validation = await validateProviderSend(target.activeAgentId, options);
  if (!validation.ok) {
    chatStore.removeMessage(userMessage.id, target.activeAgentId, target.root);
    abortTurn(target.activeAgentId, target.root);
    return validation;
  }

  return executeProviderTurn({
    root: target.root,
    chatContextKind: target.chatContextKind,
    activeAgentId: target.activeAgentId,
    turnId,
    provider: validation.provider,
    accessStatus: validation.accessStatus,
    modelId: validation.modelId,
    connectionId: validation.connectionId,
  });
}
