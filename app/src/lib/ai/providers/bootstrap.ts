import { chatStore } from "../../state/chatStore";
import { appState } from "../../state/appState";
import { createRegistryCapabilityChecker } from "./capabilityChecker";
import { createDebugChatProvider } from "./debugChatProvider";
import { createGlmChatProvider } from "./glmChatProvider";
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
  registerChatProvider(
    createGlmChatProvider(() => ({
      settings: appState.getSnapshot().settings.glmProvider,
      apiKey: appState.getSnapshot().settings.glmApiKey,
    })),
  );
  chatStore.setCapabilityChecker(
    createRegistryCapabilityChecker(
      () => appState.getSnapshot().settings.debugProvider,
      () => ({
        settings: appState.getSnapshot().settings.glmProvider,
        apiKey: appState.getSnapshot().settings.glmApiKey,
      }),
    ),
  );
  chatStore.setDefaultChatProviderResolver(() => {
    const snapshot = appState.getSnapshot().settings;
    return resolveDefaultChatProvider(
      snapshot.debugProvider,
      isGlmProviderConfigured(snapshot.glmProvider, snapshot.glmApiKey),
    );
  });
  initialized = true;
}

/** Resets provider bootstrap state for unit tests. */
export function resetChatProvidersForTests(): void {
  initialized = false;
}
