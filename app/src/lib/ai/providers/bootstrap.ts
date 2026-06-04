import { chatStore } from "../../state/chatStore";
import { appState } from "../../state/appState";
import { createRegistryCapabilityChecker } from "./capabilityChecker";
import { createDebugChatProvider } from "./debugChatProvider";
import { createOpenAiCompatibleChatProvider } from "./openAiCompatibleChatProvider";
import { registerChatProvider } from "./registry";
import { isHttpProviderConfigured, resolveDefaultChatProvider } from "./selection";

let initialized = false;

export function initializeChatProviders(): void {
  if (initialized) {
    return;
  }

  registerChatProvider(
    createDebugChatProvider(() => appState.getSnapshot().settings.providerSettings.debug),
  );
  registerChatProvider(
    createOpenAiCompatibleChatProvider(() => ({
      settings: appState.getSnapshot().settings.providerSettings.http,
      apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
    })),
  );
  chatStore.setCapabilityChecker(
    createRegistryCapabilityChecker(
      () => appState.getSnapshot().settings.providerSettings.debug,
      () => ({
        settings: appState.getSnapshot().settings.providerSettings.http,
        apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
      }),
    ),
  );
  chatStore.setDefaultChatProviderResolver(() => {
    const snapshot = appState.getSnapshot().settings;
    return resolveDefaultChatProvider(
      snapshot.providerSettings.debug,
      isHttpProviderConfigured(
        snapshot.providerSettings.http,
        snapshot.providerApiKeys.http ?? "",
      ),
    );
  });
  initialized = true;
}

/** Resets provider bootstrap state for unit tests. */
export function resetChatProvidersForTests(): void {
  initialized = false;
}
