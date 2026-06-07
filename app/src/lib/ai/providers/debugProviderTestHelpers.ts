import { appState } from "../../state/appState";
import { createRegistryCapabilityChecker } from "./capabilityChecker";
import { createDebugChatProvider, type DebugSettingsReader } from "./debugChatProvider";
import { registerChatProvider } from "./registry";
import { listSelectableChatModes } from "../modes/resolve";

export function createTestDebugWorkspaceProvider(getSettings?: DebugSettingsReader) {
  return createDebugChatProvider({
      id: "debug-workspace",
      getSettings:
        getSettings ?? (() => appState.getSnapshot().settings.providerSettings.debugWorkspace),
      getSupportedModes: () =>
        listSelectableChatModes(appState.getSnapshot().settings).map((mode) => mode.id),
      canReadWorkspaceFiles: true,
      readyMessage: "Debug Agent provider is ready for workspace chat.",
    });
}

export function registerTestDebugWorkspaceProvider(getSettings?: DebugSettingsReader): void {
  registerChatProvider(createTestDebugWorkspaceProvider(getSettings));
}

export function createTestDebugChatProvider(getSettings?: DebugSettingsReader) {
  return createDebugChatProvider({
      id: "debug-chat",
      getSettings:
        getSettings ?? (() => appState.getSnapshot().settings.providerSettings.debugChat),
      getSupportedModes: () =>
        listSelectableChatModes(appState.getSnapshot().settings).map((mode) => mode.id),
      canReadWorkspaceFiles: false,
      readyMessage: "Debug AI provider is ready for chat.",
    });
}

export function registerTestDebugChatProvider(getSettings?: DebugSettingsReader): void {
  registerChatProvider(createTestDebugChatProvider(getSettings));
}

export function registerBothTestDebugProviders(): void {
  registerTestDebugWorkspaceProvider();
  registerTestDebugChatProvider();
}

export function createTestCapabilityChecker() {
  return createRegistryCapabilityChecker(
    () => appState.getSnapshot().settings.providerSettings,
    () => ({
      settings: appState.getSnapshot().settings.providerSettings.http,
      apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
    }),
  );
}
