import { chatStore } from "../state/chatStore";
import {
  beginTurn,
  executeProviderTurn,
  findLastUserMessage,
  getLastRetryError,
  isWorkspaceSendBlockedWhenOpencodeDisabled,
  resolveSendTarget,
  shouldUseWorkspaceAgentBackend,
  validateOpencodeBackendSend,
  validateProviderSend,
  type ChatSendContextOptions,
  type ChatTurnSuccessResult,
  type SendChatMessageFailureReason,
} from "./chatSendPipeline";
import { OPENCODE_DISABLED_MESSAGE } from "./chatErrorCopy";

export type RetryLastChatTurnFailureReason =
  | SendChatMessageFailureReason
  | "no_failed_turn"
  | "no_user_message";

export type RetryLastChatTurnResult =
  | ChatTurnSuccessResult
  | { ok: false; reason: RetryLastChatTurnFailureReason; message: string };

export async function retryLastChatTurn(
  sessionId?: string,
  options?: ChatSendContextOptions,
): Promise<RetryLastChatTurnResult> {
  const target = resolveSendTarget("retry", sessionId, options);
  if (!target.ok) {
    return target;
  }

  if (!chatStore.canRetryLastTurn(target.activeSessionId)) {
    return {
      ok: false,
      reason: "no_failed_turn",
      message: "There is no failed response to retry.",
    };
  }

  const thread = chatStore.getActiveThreadSnapshot(target.activeSessionId);
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

  if (!useWorkspaceBackend && isWorkspaceSendBlockedWhenOpencodeDisabled({
    root: target.root,
    chatContextKind: target.chatContextKind,
  })) {
    return { ok: false, reason: "provider_unavailable", message: OPENCODE_DISABLED_MESSAGE };
  }

  if (useWorkspaceBackend) {
    const opencodeValidation = await validateOpencodeBackendSend(target.root, target.activeSessionId);
    if (!opencodeValidation.ok) {
      return opencodeValidation;
    }
    const previousError = getLastRetryError(target.activeSessionId);
    const turnId = beginTurn(target.activeSessionId);
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
      activeSessionId: target.activeSessionId,
      turnId,
      modelId: opencodeValidation.modelId,
      previousError,
    });
  }

  const validation = await validateProviderSend(target.activeSessionId, options);
  if (!validation.ok) {
    return validation;
  }

  const previousError = getLastRetryError(target.activeSessionId);
  const turnId = beginTurn(target.activeSessionId);
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
    activeSessionId: target.activeSessionId,
    turnId,
    provider: validation.provider,
    accessStatus: validation.accessStatus,
    modelId: validation.modelId,
    connectionId: validation.connectionId,
    previousError,
  });
}
