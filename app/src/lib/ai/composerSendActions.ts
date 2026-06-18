import { sendChatMessage, retryLastChatTurn } from "./sendChatMessage";
import { chatStore } from "../state/chatStore";
import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";
import type { WorkspaceAgentSendContext } from "./backends/workspaceAgentBackend";

export function persistActiveThreadSnapshot(): void {
  const root = chatStore.getActiveChatScopeKey();
  const agentId = chatStore.getActiveAgentId();
  const thread = agentId ? chatStore.getActiveThreadSnapshot(agentId) : null;
  if (!root || !agentId || !thread || !thread.messages.some((message) => message.role === "user")) {
    return;
  }
  scheduleAgentThreadFilePersistence(root, agentId, {
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
  getIsDebugSendBlocked: () => boolean;
  getIsHttpSendBlocked: () => boolean;
  getIsModelSendBlocked: () => boolean;
  getIsGenerating: () => boolean;
  getIsRetryDisabled: () => boolean;
  getChatContextKind: () => "workspace" | "chat-http";
  onInlineError: (message: string) => void;
}

/**
 * Extra options the composer can pass per-send (M3). Mention/attachment
 * context is forwarded into the workspace-agent backend; `onAfterSend` lets
 * the composer record the sent prompt in history regardless of send result.
 */
export interface ComposerSendOptions {
  context?: WorkspaceAgentSendContext;
  onAfterSend?: (prompt: string) => void;
}

export function createComposerSendActions(deps: ComposerSendActionsDeps) {
  async function submitMessage(options?: ComposerSendOptions): Promise<void> {
    const content = deps.getDraft().trim();
    if (
      !content ||
      deps.getSubmitInFlight() ||
      deps.getRetrying() ||
      deps.getIsBlocked() ||
      deps.getIsDebugSendBlocked() ||
      deps.getIsHttpSendBlocked() ||
      deps.getIsModelSendBlocked()
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
        chatContextKind: deps.getChatContextKind(),
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
    const result = await retryLastChatTurn(undefined, { chatContextKind: deps.getChatContextKind() });
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
