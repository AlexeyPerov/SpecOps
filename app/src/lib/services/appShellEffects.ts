/**
 * App shell reactive side effects extracted from +page.svelte.
 *
 * Effect ordering constraints:
 * 1. Agent/chat scope (syncAgentTabEffect) should run before session persistence
 *    so lastActiveAgentId reflects the current agent tab selection.
 * 2. Project tree watcher (syncProjectTreeWatcherEffect) depends on runtimeReady
 *    and activeWorkspaceRoot; load root before starting the watcher.
 * 3. Settings persistence (syncSettingsPersistenceEffect) is independent but
 *    shares the same snapshot read as session persistence — keep both in the
 *    same $effect wrapper to avoid duplicate debounced writes.
 * 4. External file watcher (syncExternalFileWatcherEffect) requires runtimeReady
 *    and the sync function injected by startAppShellRuntime.
 * 5. Active file tree expand (syncActiveFileTreeExpandEffect) runs after the
 *    project tree root is loaded for the current workspace.
 *
 * Untitled document titles are refreshed via scheduleUntitledTitleRefresh
 * (editor callback), not a reactive effect in this module.
 */

import type { AppDomainState, ContextId, TabState } from "../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID, isAgentTab } from "../domain/contracts";
import type { OpencodeHealthStatus } from "../domain/contracts";
import { appState } from "../state/appState";
import { chatStore } from "../state/chatStore";
import { syncChatAccessMonitor } from "./chatAccessMonitor";
import { normalizePathSync } from "./diskFingerprint";
import { syncProjectTreeWatcher } from "./fileWatcher";
import {
  attachOpencodeSidecarWorkspace,
  getOpencodeSidecarStatus,
  healthFromSidecarStatus,
  isOpencodeSidecarError,
  stopOpencodeSidecar,
} from "./opencodeSidecar";
import { isOpencodeEnabled } from "./opencodeSettings";
import { loadOpencodeServerPassword } from "./providerSecretsStore";
import type { createProjectTreeController } from "./projectTreeController";

type ProjectTreeController = ReturnType<typeof createProjectTreeController>;
import { ensureWorkspaceReadAccess } from "./fileSystem";
import { scheduleSessionPersistence } from "./sessionManager";
import { markWorkspaceLifecycleActive } from "./workspaceLifecycle";
import { savePersistedSettings, toPersistedSettings } from "./settingsStore";

export interface SyncAgentTabEffectInput {
  activeTab: TabState | undefined;
  isChatHttpActive: boolean;
  chatHttpRailVisible: boolean;
  activeContextId: ContextId;
  activeWorkspaceRoot: string | null;
  isAgentTabActive: boolean;
  selectedAgentId: string | null;
  lastChatScopeKey: string | null;
  ensureChatHttpAgentTab: () => void;
  restoreWorkspaceAgentSession: (workspaceRoot: string) => Promise<void>;
  setLastChatScopeKey: (key: string | null) => void;
}

export function syncAgentTabEffect(input: SyncAgentTabEffectInput): void {
  const {
    activeTab,
    isChatHttpActive,
    chatHttpRailVisible,
    activeContextId,
    activeWorkspaceRoot,
    isAgentTabActive,
    selectedAgentId,
    lastChatScopeKey,
    ensureChatHttpAgentTab,
    restoreWorkspaceAgentSession,
    setLastChatScopeKey,
  } = input;

  if (activeTab && isAgentTab(activeTab) && !isChatHttpActive) {
    if (chatStore.getActiveAgentId() !== activeTab.agentId) {
      chatStore.setActiveAgentId(activeTab.agentId);
      appState.setLastActiveAgentId(activeTab.agentId);
      void chatStore.runAccessPreflight();
    }
  }

  if (isChatHttpActive && !chatHttpRailVisible) {
    appState.switchContext("notepad");
    return;
  }

  if (isChatHttpActive) {
    selectedAgentId;
    ensureChatHttpAgentTab();
  }

  if (activeContextId === CHAT_HTTP_CONTEXT_ID) {
    if (lastChatScopeKey !== CHAT_HTTP_CONTEXT_ID) {
      if (lastChatScopeKey !== null) {
        chatStore.cancelAllGenerations(lastChatScopeKey);
      }
      setLastChatScopeKey(CHAT_HTTP_CONTEXT_ID);
      chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
      void chatStore.loadWorkspaceAgents(CHAT_HTTP_CONTEXT_ID).then(() => {
        ensureChatHttpAgentTab();
      });
    } else {
      ensureChatHttpAgentTab();
    }
    return;
  }

  if (!activeWorkspaceRoot) {
    if (lastChatScopeKey !== null) {
      chatStore.cancelAllGenerations(lastChatScopeKey);
      setLastChatScopeKey(null);
    }
    chatStore.setActiveWorkspaceRoot(null);
    return;
  }

  const normalizedWorkspaceRoot = normalizePathSync(activeWorkspaceRoot);
  if (lastChatScopeKey !== normalizedWorkspaceRoot) {
    if (lastChatScopeKey !== null) {
      chatStore.cancelAllGenerations(lastChatScopeKey);
    }
    setLastChatScopeKey(normalizedWorkspaceRoot);
    markWorkspaceLifecycleActive();
    void ensureWorkspaceReadAccess(normalizedWorkspaceRoot);
    chatStore.setActiveWorkspaceRoot(normalizedWorkspaceRoot);
    void restoreWorkspaceAgentSession(normalizedWorkspaceRoot).catch(() => {
      if (isAgentTabActive) {
        void chatStore.runAccessPreflight();
      }
    });
  }
}

export interface SyncSessionPersistenceEffectInput {
  runtimeReady: boolean;
  snapshot: AppDomainState;
  currentWindowId: string;
  activeWorkspaceRoot: string | null;
  selectedAgentId: string | null;
  sessionLastActiveAgentId: string | null | undefined;
  selectedTabId: string | null | undefined;
  lastSelectedTabId: string | null;
  onTabActivated: (tabId: string) => Promise<void>;
  setLastSelectedTabId: (tabId: string) => void;
}

export function syncSessionPersistenceEffect(input: SyncSessionPersistenceEffectInput): void {
  const {
    runtimeReady,
    snapshot,
    currentWindowId,
    activeWorkspaceRoot,
    selectedAgentId,
    sessionLastActiveAgentId,
    selectedTabId,
    lastSelectedTabId,
    onTabActivated,
    setLastSelectedTabId,
  } = input;

  if (runtimeReady && activeWorkspaceRoot) {
    const chatActiveId = selectedAgentId;
    const sessionLastActive = sessionLastActiveAgentId ?? null;
    if (chatActiveId !== sessionLastActive) {
      appState.setLastActiveAgentId(chatActiveId);
    }
  }

  if (runtimeReady) {
    const nextTabId = selectedTabId;
    if (nextTabId && nextTabId !== lastSelectedTabId) {
      setLastSelectedTabId(nextTabId);
      void onTabActivated(nextTabId);
    }
  }

  if (runtimeReady) {
    scheduleSessionPersistence(snapshot, currentWindowId);
  }
}

export interface SyncSettingsPersistenceEffectInput {
  runtimeReady: boolean;
  currentWindowId: string;
  snapshot: AppDomainState;
}

export function syncSettingsPersistenceEffect(input: SyncSettingsPersistenceEffectInput): void {
  const { runtimeReady, currentWindowId, snapshot } = input;
  if (!runtimeReady || !currentWindowId) {
    return;
  }
  void savePersistedSettings(
    toPersistedSettings({
      wrapLines: snapshot.editor.wrapLines,
      zoomPercent: snapshot.editor.zoomPercent,
      externalFiles: snapshot.settings.externalFiles,
      decoratePlaintextSymbols: snapshot.settings.decoratePlaintextSymbols,
      hideActivityRailWhenNotepadOnly: snapshot.settings.hideActivityRailWhenNotepadOnly,
      opencode: snapshot.settings.opencode,
      logSettings: snapshot.settings.logSettings,
      chatModes: snapshot.settings.chatModes,
      providerSettings: snapshot.settings.providerSettings,
      providerModelCatalogs: snapshot.settings.providerModelCatalogs,
      commandBindingOverrides: snapshot.settings.commandBindingOverrides,
      fontSettings: snapshot.settings.fontSettings,
      soundSettings: snapshot.settings.soundSettings,
      osNotificationSettings: snapshot.settings.osNotificationSettings,
    }),
  );
}

export interface SyncOpencodeToggleEffectInput {
  runtimeReady: boolean;
  opencodeEnabled: boolean;
  opencodeMode: import("../domain/contracts").OpencodeTransportMode;
}

export function syncOpencodeToggleEffect(input: SyncOpencodeToggleEffectInput): void {
  const { runtimeReady, opencodeEnabled, opencodeMode } = input;
  if (!runtimeReady || opencodeEnabled || opencodeMode !== "sidecar") {
    return;
  }
  void stopOpencodeSidecar().catch(() => {
    // best-effort; ignore errors on stop
  });
}

export interface SyncProjectTreeWatcherEffectInput {
  runtimeReady: boolean;
  activeWorkspaceRoot: string | null;
  isChatHttpActive: boolean;
  projectTreeController: ProjectTreeController;
  loadProjectTreeRoot: () => Promise<void>;
}

export interface SyncOpencodeSidecarEffectInput {
  runtimeReady: boolean;
  workspaceLifecycleActive: boolean;
  activeWorkspaceRoot: string | null;
  isChatHttpActive: boolean;
  opencodeEnabled: boolean;
  opencodeMode: import("../domain/contracts").OpencodeTransportMode;
  opencodeBaseUrl: string;
  serverPassword?: string;
  setOpencodeHealth: (patch: Partial<import("../domain/contracts").OpencodeHealthState>) => void;
}

const URL_HEALTH_TIMEOUT_MS = 10_000;

interface UrlHealthProbeResult {
  status: OpencodeHealthStatus;
  message: string | null;
}

async function resolveServerPassword(provided: string | undefined): Promise<string> {
  if (provided !== undefined) {
    return provided;
  }
  try {
    return await loadOpencodeServerPassword();
  } catch {
    return "";
  }
}

export async function probeUrlHealth(
  baseUrl: string,
  serverPassword: string,
): Promise<UrlHealthProbeResult> {
  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    return { status: "error", message: "OpenCode URL is invalid." };
  }
  const healthUrl = new URL("/global/health", endpoint);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), URL_HEALTH_TIMEOUT_MS);
  const headers: Record<string, string> = {};
  if (serverPassword.trim().length > 0) {
    headers["Authorization"] = `Basic ${btoa(`opencode:${serverPassword}`)}`;
  }
  try {
    const response = await fetch(healthUrl.toString(), {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (response.status === 401) {
      return {
        status: "degraded",
        message:
          "OpenCode server requires authentication. Set Server password in Settings \u2192 Workspaces \u2192 OpenCode.",
      };
    }
    if (!response.ok) {
      return {
        status: "degraded",
        message: `OpenCode server responded with HTTP ${response.status}.`,
      };
    }
    return { status: "healthy", message: null };
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        status: "error",
        message: `OpenCode health check timed out after ${URL_HEALTH_TIMEOUT_MS / 1000}s.`,
      };
    }
    const message = error instanceof Error ? error.message : "OpenCode URL is unreachable.";
    return { status: "error", message };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function syncOpencodeSidecarEffect(input: SyncOpencodeSidecarEffectInput): void {
  const {
    runtimeReady,
    workspaceLifecycleActive,
    activeWorkspaceRoot,
    isChatHttpActive,
    opencodeEnabled,
    opencodeMode,
    opencodeBaseUrl,
    setOpencodeHealth,
  } = input;

  if (!runtimeReady || !workspaceLifecycleActive || !activeWorkspaceRoot || isChatHttpActive) {
    return;
  }

  if (!opencodeEnabled) {
    setOpencodeHealth({
      status: "unknown",
      source: null,
      checkedAt: new Date().toISOString(),
      lastErrorMessage: null,
    });
    return;
  }

  setOpencodeHealth({
    status: "checking",
    source: opencodeMode,
    checkedAt: new Date().toISOString(),
    lastErrorMessage: null,
  });

  if (opencodeMode === "url") {
    let endpoint: URL;
    try {
      endpoint = new URL(opencodeBaseUrl);
    } catch {
      setOpencodeHealth({
        status: "error",
        source: "url",
        checkedAt: new Date().toISOString(),
        lastErrorMessage: "OpenCode URL is invalid. Update Settings -> Workspaces -> OpenCode.",
      });
      return;
    }
    void (async () => {
      const password = await resolveServerPassword(input.serverPassword);
      const result = await probeUrlHealth(endpoint.toString(), password);
      setOpencodeHealth({
        status: result.status,
        source: "url",
        checkedAt: new Date().toISOString(),
        lastErrorMessage: result.message,
      });
    })();
    return;
  }

  void attachOpencodeSidecarWorkspace(activeWorkspaceRoot)
    .then((status) => {
      setOpencodeHealth({
        status: healthFromSidecarStatus(status.health),
        source: "sidecar",
        checkedAt: new Date().toISOString(),
        lastErrorMessage: status.lastError?.message ?? null,
      });
    })
    .catch((error: unknown) => {
      const message =
        isOpencodeSidecarError(error) && error.message.trim().length > 0
          ? error.message
          : "Failed to start or attach OpenCode sidecar.";
      setOpencodeHealth({
        status: "error",
        source: "sidecar",
        checkedAt: new Date().toISOString(),
        lastErrorMessage: message,
      });
    });
}

export function requestOpencodeHealthRefresh(input: {
  opencodeEnabled: boolean;
  opencodeMode: import("../domain/contracts").OpencodeTransportMode;
  opencodeBaseUrl: string;
  serverPassword?: string;
  setOpencodeHealth: (patch: Partial<import("../domain/contracts").OpencodeHealthState>) => void;
}): void {
  const { opencodeEnabled, opencodeMode, opencodeBaseUrl, setOpencodeHealth } = input;
  if (!opencodeEnabled) {
    setOpencodeHealth({
      status: "unknown",
      source: null,
      checkedAt: new Date().toISOString(),
      lastErrorMessage: null,
    });
    return;
  }
  if (opencodeMode === "sidecar") {
    setOpencodeHealth({
      status: "checking",
      source: "sidecar",
      checkedAt: new Date().toISOString(),
      lastErrorMessage: null,
    });
    void getOpencodeSidecarStatus()
      .then((status) => {
        setOpencodeHealth({
          status: healthFromSidecarStatus(status.health),
          source: "sidecar",
          checkedAt: new Date().toISOString(),
          lastErrorMessage: status.lastError?.message ?? null,
        });
      })
      .catch((error: unknown) => {
        const message =
          isOpencodeSidecarError(error) && error.message.trim().length > 0
            ? error.message
            : "Failed to read OpenCode sidecar status.";
        setOpencodeHealth({
          status: "error",
          source: "sidecar",
          checkedAt: new Date().toISOString(),
          lastErrorMessage: message,
        });
      });
    return;
  }

  setOpencodeHealth({
    status: "checking",
    source: "url",
    checkedAt: new Date().toISOString(),
    lastErrorMessage: null,
  });
  void (async () => {
    const password = await resolveServerPassword(input.serverPassword);
    const result = await probeUrlHealth(opencodeBaseUrl, password);
    setOpencodeHealth({
      status: result.status,
      source: "url",
      checkedAt: new Date().toISOString(),
      lastErrorMessage: result.message,
    });
  })();
}

export function syncProjectTreeWatcherEffect(input: SyncProjectTreeWatcherEffectInput): void {
  const {
    runtimeReady,
    activeWorkspaceRoot,
    isChatHttpActive,
    projectTreeController,
    loadProjectTreeRoot,
  } = input;

  if (!activeWorkspaceRoot || isChatHttpActive) {
    void syncProjectTreeWatcher(null);
    projectTreeController.clearFilesystemChangeDebounce();
    return;
  }

  void loadProjectTreeRoot();

  if (runtimeReady) {
    void syncProjectTreeWatcher(activeWorkspaceRoot);
  }
}

export interface SyncChatAccessMonitorEffectInput {
  runtimeReady: boolean;
  isAgentTabActive: boolean;
  activeWorkspaceRoot: string | null;
  isChatHttpActive: boolean;
}

export function syncChatAccessMonitorEffect(input: SyncChatAccessMonitorEffectInput): void {
  const { runtimeReady, isAgentTabActive, activeWorkspaceRoot, isChatHttpActive } = input;
  if (!runtimeReady) {
    return;
  }
  syncChatAccessMonitor(isAgentTabActive && Boolean(activeWorkspaceRoot) && !isChatHttpActive);
}

export interface SyncExternalFileWatcherEffectInput {
  runtimeReady: boolean;
  snapshot: AppDomainState;
  syncExternalFileWatcher: ((state: AppDomainState) => Promise<void>) | null;
}

export function syncExternalFileWatcherEffect(input: SyncExternalFileWatcherEffectInput): void {
  const { runtimeReady, snapshot, syncExternalFileWatcher } = input;
  if (!runtimeReady || !syncExternalFileWatcher) {
    return;
  }
  void syncExternalFileWatcher(snapshot);
}

export interface SyncActiveFileTreeExpandEffectInput {
  activeDocumentPath: string | null;
  isChatHttpActive: boolean;
  activeWorkspaceRoot: string | null;
  projectTreeController: ProjectTreeController;
}

export function syncActiveFileTreeExpandEffect(input: SyncActiveFileTreeExpandEffectInput): void {
  const { activeDocumentPath, isChatHttpActive, activeWorkspaceRoot, projectTreeController } = input;
  if (!activeDocumentPath || isChatHttpActive) {
    return;
  }
  void projectTreeController.ensureExpandedForActiveFile(activeWorkspaceRoot, activeDocumentPath);
}

export interface SyncWorkspaceContextEffectInput {
  activeContextId: ContextId;
  handleActiveContextSwitch: (contextId: ContextId) => void;
}

export function syncWorkspaceContextEffect(input: SyncWorkspaceContextEffectInput): void {
  const { activeContextId, handleActiveContextSwitch } = input;
  if (!activeContextId) {
    return;
  }
  handleActiveContextSwitch(activeContextId);
}

export interface SyncResponsiveLayoutEffectInput {
  applyResponsiveLayoutRules: () => void;
}

export function syncResponsiveLayoutEffect(_input: SyncResponsiveLayoutEffectInput): void {
  _input.applyResponsiveLayoutRules();
}
