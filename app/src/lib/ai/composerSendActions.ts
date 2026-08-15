import { sendChatMessage, retryLastChatTurn } from "./sendChatMessage";
import { chatStore } from "../state/chatStore";
import { scheduleSessionThreadFilePersistence } from "../services/chatPersistence";
import type { ChatSendContext } from "./chatSendPipeline";

export function persistActiveThreadSnapshot(): void {
  const root = chatStore.getActiveChatScopeKey();
  const sessionId = chatStore.getActiveSessionId();
  const thread = sessionId ? chatStore.getActiveThreadSnapshot(sessionId) : null;
  if (!root || !sessionId || !thread || !thread.messages.some((message) => message.role === "user")) {
    return;
  }
  scheduleSessionThreadFilePersistence(root, sessionId, {
    version: 1,
    thread,
  });
}

export interface ComposerSendActionsDeps {
  getDraft: () => string;
  setDraft: (value: string) => void;
  getSubmitInFlight: () => boolean;
  setSubmitInFlight: (value: boolean) => void;
  getRetrying: () => boolean;
  setRetrying: (value: boolean) => void;
  getIsBlocked: () => boolean;
  getIsGenerating: () => boolean;
  getIsRetryDisabled: () => boolean;
  onInlineError: (message: string) => void;
}

/**
 * Extra options the composer can pass per-send. Mention/attachment context is
 * forwarded into the host turn request; `onAfterSend` lets the composer record
 * the sent prompt in history regardless of send result.
 */
export interface ComposerSendOptions {
  context?: ChatSendContext;
  onAfterSend?: (prompt: string) => void;
}

export function createComposerSendActions(deps: ComposerSendActionsDeps) {
  async function submitMessage(options?: ComposerSendOptions): Promise<void> {
    const content = deps.getDraft().trim();
    if (
      !content ||
      deps.getSubmitInFlight() ||
      deps.getRetrying() ||
      deps.getIsBlocked()
    ) {
      return;
    }
    // While a turn is running the composer doesn't reach submitMessage — it
    // enqueues instead. Defensive guard kept for safety.
    if (deps.getIsGenerating()) {
      return;
    }

    deps.setSubmitInFlight(true);
    deps.setDraft("");
    deps.onInlineError("");
    try {
      const result = await sendChatMessage(content, undefined, {
        ...(options?.context ? { context: options.context } : {}),
      });
      if (!result.ok) {
        deps.onInlineError(result.message);
      } else {
        options?.onAfterSend?.(content);
      }
    } finally {
      deps.setSubmitInFlight(false);
    }
  }

  async function retryLastTurn(): Promise<void> {
    if (deps.getIsRetryDisabled()) {
      return;
    }

    deps.setRetrying(true);
    deps.onInlineError("");
    const result = await retryLastChatTurn();
    if (!result.ok) {
      deps.onInlineError(result.message);
    }
    deps.setRetrying(false);
  }

  return {
    submitMessage,
    retryLastTurn,
    persistActiveThreadSnapshot,
  };
}
