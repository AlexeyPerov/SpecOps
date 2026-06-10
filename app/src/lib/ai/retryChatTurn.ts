import { chatStore } from "../state/chatStore";
import {
  beginTurn,
  executeProviderTurn,
  findLastUserMessage,
  getLastRetryError,
  resolveSendTarget,
  shouldUseWorkspaceAgentBackend,
  validateOpencodeBackendSend,
  validateProviderSend,
  type ChatSendContextOptions,
  type ChatTurnSuccessResult,
  type SendChatMessageFailureReason,
} from "./chatSendPipeline";

export type RetryLastChatTurnFailureReason =
  | SendChatMessageFailureReason
  | "no_failed_turn"
  | "no_user_message";

export type RetryLastChatTurnResult =
  | ChatTurnSuccessResult
  | { ok: false; reason: RetryLastChatTurnFailureReason; message: string };

export async function retryLastChatTurn(
  agentId?: string,
  options?: ChatSendContextOptions,
): Promise<RetryLastChatTurnResult> {
  const target = resolveSendTarget("retry", agentId, options);
  if (!target.ok) {
    return target;
  }

  if (!chatStore.canRetryLastTurn(target.activeAgentId)) {
    return {
      ok: false,
      reason: "no_failed_turn",
      message: "There is no failed response to retry.",
    };
  }

  const thread = chatStore.getActiveThreadSnapshot(target.activeAgentId);
  if (!findLastUserMessage(thread?.messages ?? [])) {
    return {
      ok: false,
      reason: "no_user_message",
      message: "Could not find the last user message to retry.",
    };
  }

  const useWorkspaceBackend = shouldUseWorkspaceAgentBackend({
    root: target.root,
    chatContextKind: target.chatContextKind,
  });

  if (useWorkspaceBackend) {
    const opencodeValidation = await validateOpencodeBackendSend(target.root, target.activeAgentId);
    if (!opencodeValidation.ok) {
      return opencodeValidation;
    }
    const previousError = getLastRetryError(target.activeAgentId);
    const turnId = beginTurn(target.activeAgentId);
    if (!turnId) {
      return {
        ok: false,
        reason: "generating",
        message: "Another response is already in progress.",
      };
    }
    return executeProviderTurn({
      root: target.root,
      chatContextKind: target.chatContextKind,
      activeAgentId: target.activeAgentId,
      turnId,
      modelId: opencodeValidation.modelId,
      previousError,
    });
  }

  const validation = await validateProviderSend(target.activeAgentId, options);
  if (!validation.ok) {
    return validation;
  }

  const previousError = getLastRetryError(target.activeAgentId);
  const turnId = beginTurn(target.activeAgentId);
  if (!turnId) {
    return {
      ok: false,
      reason: "generating",
      message: "Another response is already in progress.",
    };
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
    previousError,
  });
}
