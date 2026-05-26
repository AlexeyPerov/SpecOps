import type { ChatProviderId } from "../../domain/contracts";
import type { ChatProvider } from "./types";

const providersById = new Map<ChatProviderId, ChatProvider>();

export function registerChatProvider(provider: ChatProvider): void {
  providersById.set(provider.id, provider);
}

export function unregisterChatProvider(id: ChatProviderId): void {
  providersById.delete(id);
}

export function getChatProvider(id: ChatProviderId): ChatProvider | null {
  return providersById.get(id) ?? null;
}

export function resolveChatProvider(id: ChatProviderId): ChatProvider {
  const provider = getChatProvider(id);
  if (!provider) {
    throw new Error(`No chat provider registered for id: ${id}`);
  }
  return provider;
}

export function listRegisteredChatProviders(): ChatProviderId[] {
  return [...providersById.keys()];
}

/** Clears registry state between unit tests. */
export function resetChatProviderRegistryForTests(): void {
  providersById.clear();
}
