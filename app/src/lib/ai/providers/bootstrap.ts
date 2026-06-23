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
import { resolveDefaultConnectionForProvider } from "../../state/chatStore/threadHelpers";
import { listSelectableChatModes } from "../modes/resolve";
import { isOpencodeEnabled } from "../../services/opencodeSettings";
import {
  getOpencodeCatalog,
  isOpencodeCatalogReady,
} from "../opencodeCatalog";
import type { WorkspaceReadinessChecker } from "../capabilities";

let initialized = false;

export function initializeChatProviders(): void {
  if (initialized) {
    return;
  }

  registerChatProvider(
    createDebugChatProvider({
      id: "debug-workspace",
      getSettings: () => appState.getSnapshot().settings.providerSettings.debugWorkspace,
      getSupportedModes: () =>
        listSelectableChatModes(appState.getSnapshot().settings).map((mode) => mode.id),
      canReadWorkspaceFiles: true,
      readyMessage: "Debug Agent provider is ready for workspace chat.",
    }),
  );
  registerChatProvider(
    createDebugChatProvider({
      id: "debug-chat",
      getSettings: () => appState.getSnapshot().settings.providerSettings.debugChat,
      getSupportedModes: () =>
        listSelectableChatModes(appState.getSnapshot().settings).map((mode) => mode.id),
      canReadWorkspaceFiles: false,
      readyMessage: "Debug AI provider is ready for chat.",
    }),
  );
  registerChatProvider(
    createOpenAiCompatibleChatProvider(
      (connectionId) => {
        const snapshot = appState.getSnapshot().settings;
        const resolved = resolveHttpConnection(
          snapshot.providerSettings,
          snapshot.providerApiKeys,
          connectionId,
        );
        return {
          settings:
            resolved?.connection ??
            snapshot.providerSettings.httpConnections?.[0] ??
            snapshot.providerSettings.http,
          apiKey: resolved?.apiKey ?? "",
        };
      },
      () => listSelectableChatModes(appState.getSnapshot().settings).map((mode) => mode.id),
    ),
  );
  chatStore.setCapabilityChecker(
    createRegistryCapabilityChecker(
      () => appState.getSnapshot().settings.providerSettings,
      () => ({
        settings: (() => {
          const snapshot = appState.getSnapshot().settings;
          const resolved = resolveHttpConnection(
            snapshot.providerSettings,
            snapshot.providerApiKeys,
          );
          return (
            resolved?.connection ??
            snapshot.providerSettings.httpConnections?.[0] ??
            snapshot.providerSettings.http
          );
        })(),
        apiKey: (() => {
          const snapshot = appState.getSnapshot().settings;
          return (
            resolveHttpConnection(snapshot.providerSettings, snapshot.providerApiKeys)?.apiKey ?? ""
          );
        })(),
      }),
    ),
  );
  chatStore.setWorkspaceReadinessChecker(
    createWorkspaceReadinessChecker(
      () => appState.getSnapshot().settings.opencode,
      () => appState.getSnapshot().settings.opencodeHealth.status,
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
  chatStore.setDefaultThreadConnectionResolver((provider) => {
    const snapshot = appState.getSnapshot().settings;
    return resolveDefaultConnectionForProvider(
      provider,
      snapshot.providerSettings,
      snapshot.providerApiKeys,
    );
  });
  initialized = true;
}

/** Resets provider bootstrap state for unit tests. */
export function resetChatProvidersForTests(): void {
  initialized = false;
}

function createWorkspaceReadinessChecker(
  getOpencodeSettings: () => import("../../domain/contracts").OpencodeSettings,
  getOpencodeHealthStatus: () => import("../../domain/contracts").OpencodeHealthStatus,
): WorkspaceReadinessChecker {
  return {
    checkReadiness(workspaceRootPath: string) {
      const settings = getOpencodeSettings();
      if (!isOpencodeEnabled(settings)) {
        return {
          ready: false,
          message: "OpenCode is disabled. Enable it in Settings → Workspaces → OpenCode.",
          recoveryHint: "Enable OpenCode in Settings → Workspaces → OpenCode.",
        };
      }
      const health = getOpencodeHealthStatus();
      // M13.5 — only hard errors block typing. The sidecar starts lazily on
      // Send; "unknown" / "checking" while the sidecar isn't running is the
      // expected idle state and must not block the composer.
      if (health === "error") {
        return {
          ready: false,
          message: "OpenCode server is unavailable. Check server health and retry.",
          recoveryHint: "Check OpenCode server health in Settings → Workspaces → OpenCode.",
        };
      }
      if (!isOpencodeCatalogReady(workspaceRootPath)) {
        const catalog = getOpencodeCatalog(workspaceRootPath);
        if (catalog.status === "loading") {
          return {
            ready: false,
            message: "Loading OpenCode model catalog…",
          };
        }
        if (catalog.status === "error") {
          return {
            ready: false,
            message: catalog.lastErrorMessage ?? "Failed to load OpenCode catalog.",
            recoveryHint: "Refresh the model list in the session composer.",
          };
        }
        return {
          ready: false,
          message: "OpenCode catalog is not loaded yet.",
        };
      }
      return { ready: true, message: "" };
    },
  };
}
