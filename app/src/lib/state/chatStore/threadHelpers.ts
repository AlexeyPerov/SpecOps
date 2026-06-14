import type {
  AppProviderSettings,
  ChatMessage,
  ChatProviderId,
  ChatThreadMetadata,
  ChatThreadSnapshot,
  ProviderModelCatalogs,
} from "../../domain/contracts";
import { normalizeProviderModelCatalogs } from "../../ai/providers/providerModelCatalog";
import { resolveHttpConnection } from "../../ai/providers/httpConnectionSettings";

export const DEFAULT_CHAT_MODE = "ask" as const;
const DEFAULT_CHAT_PROVIDER: ChatProviderId = "http";

let defaultChatProviderResolver: () => ChatProviderId = () => DEFAULT_CHAT_PROVIDER;
let defaultThreadConnectionResolver:
  | ((provider: ChatProviderId) => string | undefined)
  | null = null;

export function setDefaultChatProviderResolver(resolver: () => ChatProviderId): void {
  defaultChatProviderResolver = resolver;
}

export function getDefaultChatProvider(): ChatProviderId {
  return defaultChatProviderResolver();
}

export function setDefaultThreadConnectionResolver(
  resolver: ((provider: ChatProviderId) => string | undefined) | null,
): void {
  defaultThreadConnectionResolver = resolver;
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
  const provider = defaultChatProviderResolver();
  return {
    agentId,
    threadId: agentId,
    mode: DEFAULT_CHAT_MODE,
    provider,
    createdAt,
    updatedAt: createdAt,
    connectionId: defaultThreadConnectionResolver?.(provider),
  };
}

export function applyMetadataPatch(
  metadata: ChatThreadMetadata,
  patch: Partial<
    Pick<
      ChatThreadMetadata,
      | "mode"
      | "provider"
      | "summary"
      | "selectedModelId"
      | "connectionId"
      | "opencodeAgentId"
      | "opencodeProviderId"
    >
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

export function resolveDefaultConnectionForProvider(
  provider: ChatProviderId,
  providerSettings: AppProviderSettings,
  providerApiKeys: Partial<Record<string, string>>,
): string | undefined {
  if (provider !== "http") {
    return undefined;
  }
  return resolveHttpConnection(providerSettings, providerApiKeys)?.connection.id;
}

export function resolveModelForConnection(
  providerCatalogs: ProviderModelCatalogs,
  connectionCatalog: { defaultModelId: string; modelIds: string[] },
): string {
  // Keep thread-selected model aligned with selected connection catalog while preserving global defaults.
  const normalized = normalizeProviderModelCatalogs(providerCatalogs);
  const connectionDefault = connectionCatalog.defaultModelId.trim();
  if (connectionDefault.length > 0 && connectionCatalog.modelIds.includes(connectionDefault)) {
    return connectionDefault;
  }
  return normalized.http?.defaultModelId ?? "gpt-4o-mini";
}
