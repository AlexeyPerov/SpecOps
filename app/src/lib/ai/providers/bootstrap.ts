import { chatStore } from "../../state/chatStore";
import { appState } from "../../state/appState";
import { createRegistryCapabilityChecker } from "./capabilityChecker";
import { createDebugChatProvider } from "./debugChatProvider";
import { createOpenAiCompatibleChatProvider } from "./openAiCompatibleChatProvider";
import { registerChatProvider } from "./registry";
import {
  resolveChatContextKind,
  resolveDefaultChatProvider,
} from "./selection";
import { listConfiguredHttpConnections, resolveHttpConnection } from "./httpConnectionSettings";

let initialized = false;

export function initializeChatProviders(): void {
  if (initialized) {
    return;
  }

  registerChatProvider(
    createDebugChatProvider({
      id: "debug-workspace",
      getSettings: () => appState.getSnapshot().settings.providerSettings.debugWorkspace,
      supportedModes: ["ask", "review"],
      canReadWorkspaceFiles: true,
      readyMessage: "Debug Agent provider is ready for workspace chat.",
    }),
  );
  registerChatProvider(
    createDebugChatProvider({
      id: "debug-chat",
      getSettings: () => appState.getSnapshot().settings.providerSettings.debugChat,
      supportedModes: ["ask"],
      canReadWorkspaceFiles: false,
      readyMessage: "Debug AI provider is ready for chat.",
    }),
  );
  registerChatProvider(
    createOpenAiCompatibleChatProvider(() => ({
      settings:
        resolveHttpConnection(
          appState.getSnapshot().settings.providerSettings,
          appState.getSnapshot().settings.providerApiKeys,
        )?.connection ??
        appState.getSnapshot().settings.providerSettings.httpConnections?.[0] ??
        appState.getSnapshot().settings.providerSettings.http,
      apiKey:
        resolveHttpConnection(
          appState.getSnapshot().settings.providerSettings,
          appState.getSnapshot().settings.providerApiKeys,
        )?.apiKey ?? "",
    })),
  );
  chatStore.setCapabilityChecker(
    createRegistryCapabilityChecker(
      () => appState.getSnapshot().settings.providerSettings,
      () => ({
        settings:
          resolveHttpConnection(
            appState.getSnapshot().settings.providerSettings,
            appState.getSnapshot().settings.providerApiKeys,
          )?.connection ??
          appState.getSnapshot().settings.providerSettings.httpConnections?.[0] ??
          appState.getSnapshot().settings.providerSettings.http,
        apiKey:
          resolveHttpConnection(
            appState.getSnapshot().settings.providerSettings,
            appState.getSnapshot().settings.providerApiKeys,
          )?.apiKey ?? "",
      }),
    ),
  );
  chatStore.setDefaultChatProviderResolver(() => {
    const snapshot = appState.getSnapshot().settings;
    const scopeKey = chatStore.getActiveChatScopeKey();
    const chatContextKind = scopeKey ? resolveChatContextKind(scopeKey) : "workspace";
    return resolveDefaultChatProvider(
      snapshot.providerSettings,
      { chatContextKind },
      listConfiguredHttpConnections(snapshot.providerSettings, snapshot.providerApiKeys).length > 0,
    );
  });
  initialized = true;
}

/** Resets provider bootstrap state for unit tests. */
export function resetChatProvidersForTests(): void {
  initialized = false;
}
