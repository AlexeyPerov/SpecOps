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
    createDebugChatProvider(() => appState.getSnapshot().settings.providerSettings.debug),
  );
  registerChatProvider(
    createGlmChatProvider(() => ({
      settings: appState.getSnapshot().settings.providerSettings.glm,
      apiKey: appState.getSnapshot().settings.glmApiKey,
    })),
  );
  chatStore.setCapabilityChecker(
    createRegistryCapabilityChecker(
      () => appState.getSnapshot().settings.providerSettings.debug,
      () => ({
        settings: appState.getSnapshot().settings.providerSettings.glm,
        apiKey: appState.getSnapshot().settings.glmApiKey,
      }),
    ),
  );
  chatStore.setDefaultChatProviderResolver(() => {
    const snapshot = appState.getSnapshot().settings;
    return resolveDefaultChatProvider(
      snapshot.providerSettings.debug,
      isGlmProviderConfigured(snapshot.providerSettings.glm, snapshot.glmApiKey),
    );
  });
  initialized = true;
}

/** Resets provider bootstrap state for unit tests. */
export function resetChatProvidersForTests(): void {
  initialized = false;
}
