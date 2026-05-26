import { chatStore } from "../../state/chatStore";
import { appState } from "../../state/appState";
import { createRegistryCapabilityChecker } from "./capabilityChecker";
import { createDebugChatProvider } from "./debugChatProvider";
import { registerChatProvider } from "./registry";
import { isGlmProviderConfigured, resolveDefaultChatProvider } from "./selection";

let initialized = false;

export function initializeChatProviders(): void {
  if (initialized) {
    return;
  }

  registerChatProvider(
    createDebugChatProvider(() => appState.getSnapshot().settings.debugProvider),
  );
  chatStore.setCapabilityChecker(
    createRegistryCapabilityChecker(() => appState.getSnapshot().settings.debugProvider),
  );
  chatStore.setDefaultChatProviderResolver(() =>
    resolveDefaultChatProvider(
      appState.getSnapshot().settings.debugProvider,
      isGlmProviderConfigured(),
    ),
  );
  initialized = true;
}

/** Resets provider bootstrap state for unit tests. */
export function resetChatProvidersForTests(): void {
  initialized = false;
}
