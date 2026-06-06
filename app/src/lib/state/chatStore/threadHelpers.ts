import type {
  ChatMessage,
  ChatProviderId,
  ChatThreadMetadata,
  ChatThreadSnapshot,
} from "../../domain/contracts";

export const DEFAULT_CHAT_MODE = "ask" as const;
const DEFAULT_CHAT_PROVIDER: ChatProviderId = "http";

let defaultChatProviderResolver: () => ChatProviderId = () => DEFAULT_CHAT_PROVIDER;

export function setDefaultChatProviderResolver(resolver: () => ChatProviderId): void {
  defaultChatProviderResolver = resolver;
}

export function getDefaultChatProvider(): ChatProviderId {
  return defaultChatProviderResolver();
}

export function cloneThread(thread: ChatThreadSnapshot | null): ChatThreadSnapshot | null {
  if (!thread) {
    return null;
  }
  return {
    metadata: { ...thread.metadata },
    messages: thread.messages.map((message) => ({
      ...message,
      systemEvent: message.systemEvent ? { ...message.systemEvent } : undefined,
    })),
  };
}

export function createThreadMetadata(agentId: string, createdAt: string): ChatThreadMetadata {
  return {
    agentId,
    threadId: agentId,
    mode: DEFAULT_CHAT_MODE,
    provider: defaultChatProviderResolver(),
    createdAt,
    updatedAt: createdAt,
  };
}

export function applyMetadataPatch(
  metadata: ChatThreadMetadata,
  patch: Partial<
    Pick<ChatThreadMetadata, "mode" | "provider" | "summary" | "selectedModelId" | "connectionId">
  >,
  updatedAt: string,
): ChatThreadMetadata {
  return {
    ...metadata,
    ...patch,
    updatedAt,
  };
}

export function formatCompactionNotice(compactedMessageCount: number): string {
  const label = compactedMessageCount === 1 ? "message" : "messages";
  return `${compactedMessageCount} older ${label} compacted to stay within chat retention limits.`;
}
