import type { ChatMessage, ChatThreadSnapshot } from "../../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID } from "../../domain/contracts";
import {
  coerceProviderForScope,
  isLegacyChatProviderId,
  normalizeLegacyChatProviderId,
  type LegacyChatProviderId,
} from "./debugProviderSettings";
import type { ChatStoreState } from "../../state/chatStore/types";

function normalizeMessageForScope(message: ChatMessage, scopeKey: string): ChatMessage {
  if (!message.systemEvent) {
    return message;
  }
  if (message.systemEvent.type === "provider-switched") {
    const fromProvider = message.systemEvent.fromProvider;
    const normalizedFrom =
      fromProvider === null
        ? null
        : isLegacyChatProviderId(fromProvider)
          ? normalizeLegacyChatProviderId(fromProvider, scopeKey)
          : fromProvider;
    const normalizedTo = isLegacyChatProviderId(message.systemEvent.toProvider)
      ? normalizeLegacyChatProviderId(message.systemEvent.toProvider, scopeKey)
      : message.systemEvent.toProvider;
    if (
      normalizedFrom === message.systemEvent.fromProvider &&
      normalizedTo === message.systemEvent.toProvider
    ) {
      return message;
    }
    return {
      ...message,
      systemEvent: {
        ...message.systemEvent,
        fromProvider: normalizedFrom,
        toProvider: normalizedTo,
      },
    };
  }
  return message;
}

/** Normalizes legacy provider ids and chat-http mode constraints for a loaded thread. */
export function normalizeThreadSnapshotForScope(
  thread: ChatThreadSnapshot | null,
  scopeKey: string,
): ChatThreadSnapshot | null {
  if (!thread) {
    return null;
  }

  let metadata = thread.metadata;
  let changed = false;

  const legacyProvider = metadata.provider as LegacyChatProviderId;
  const normalizedLegacy = isLegacyChatProviderId(legacyProvider)
    ? normalizeLegacyChatProviderId(legacyProvider, scopeKey)
    : metadata.provider;
  const nextProvider = coerceProviderForScope(normalizedLegacy, scopeKey);
  if (nextProvider !== metadata.provider) {
    metadata = { ...metadata, provider: nextProvider };
    changed = true;
  }

  const nextMode = scopeKey === CHAT_HTTP_CONTEXT_ID ? "ask" : metadata.mode;
  if (nextMode !== metadata.mode) {
    metadata = { ...metadata, mode: nextMode };
    changed = true;
  }

  const messages = thread.messages.map((message) => normalizeMessageForScope(message, scopeKey));
  const messagesChanged = messages.some((message, index) => message !== thread.messages[index]);
  if (!changed && !messagesChanged) {
    return thread;
  }

  return {
    metadata,
    messages,
  };
}

/** Normalizes in-memory thread metadata when switching chat scope. */
export function normalizeWorkspaceThreadsForScope(
  state: ChatStoreState,
  scopeKey: string,
): ChatStoreState {
  const workspace = state.workspaces[scopeKey];
  if (!workspace) {
    return state;
  }

  let threadsChanged = false;
  const threadsByAgentId = { ...workspace.threadsByAgentId };
  for (const [agentId, thread] of Object.entries(threadsByAgentId)) {
    const normalized = normalizeThreadSnapshotForScope(thread, scopeKey);
    if (normalized && normalized !== thread) {
      threadsByAgentId[agentId] = normalized;
      threadsChanged = true;
    }
  }

  if (!threadsChanged) {
    return state;
  }

  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      [scopeKey]: {
        ...workspace,
        threadsByAgentId,
      },
    },
  };
}
