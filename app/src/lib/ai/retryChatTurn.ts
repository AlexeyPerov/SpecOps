import { chatStore } from "../state/chatStore";
import { appState } from "../state/appState";
import {
  beginTurn,
  executeProviderTurn,
  findLastUserMessage,
  getLastRetryError,
  resolveSendTarget,
  validateAgentHostSend,
  type ChatSendContextOptions,
  type ChatTurnSuccessResult,
  type SendChatMessageFailureReason,
} from "./chatSendPipeline";
import { OPENCODE_DISABLED_MESSAGE } from "./chatErrorCopy";
import { isOpencodeEnabled } from "../services/opencodeSettings";

export type RetryLastChatTurnFailureReason =
  | SendChatMessageFailureReason
  | "no_failed_turn"
  | "no_user_message";

export type RetryLastChatTurnResult =
  | ChatTurnSuccessResult
  | { ok: false; reason: RetryLastChatTurnFailureReason; message: string };

export async function retryLastChatTurn(
  sessionId?: string,
  _options?: ChatSendContextOptions,
): Promise<RetryLastChatTurnResult> {
  const target = resolveSendTarget("retry", sessionId);
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

  if (!isOpencodeEnabled(appState.getSnapshot().settings.opencode)) {
    return { ok: false, reason: "provider_unavailable", message: OPENCODE_DISABLED_MESSAGE };
  }

  const validation = await validateAgentHostSend(target.root, target.activeSessionId);
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
    activeSessionId: target.activeSessionId,
    turnId,
    modelId: validation.modelId,
    modeId: validation.modeId,
    previousError,
  });
}
