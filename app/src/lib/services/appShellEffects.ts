/**
 * App shell reactive side effects extracted from +page.svelte.
 *
 * Effect ordering constraints:
 * 1. Session/chat scope (syncSessionTabEffect) should run before session persistence
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
import { CHAT_HTTP_CONTEXT_ID, isSessionTab } from "../domain/contracts";
import type { OpencodeHealthStatus } from "../domain/contracts";
import { appState } from "../state/appState";
import { chatStore } from "../state/chatStore";
import { syncChatAccessMonitor } from "./chatAccessMonitor";
import { normalizePathSync } from "./diskFingerprint";
import { syncProjectTreeWatcher } from "./fileWatcher";
import {
  getOpencodeSidecarStatus,
  healthFromSidecarStatus,
  isOpencodeSidecarError,
  stopOpencodeSidecar,
} from "./opencodeSidecar";
import {
  ensureOpencodeSidecar,
  isOpencodeSidecarBlocked,
  clearOpencodeSidecarCircuitBreaker,
} from "./opencodeSidecarEnsure";
import { isOpencodeEnabled } from "./opencodeSettings";
import { loadOpencodeServerPassword } from "./providerSecretsStore";
import type { createProjectTreeController } from "./projectTreeController";

type ProjectTreeController = ReturnType<typeof createProjectTreeController>;
import { ensureWorkspaceReadAccess } from "./fileSystem";
import { logDiagnostic } from "./logging";
import { scheduleSessionPersistence } from "./sessionManager";
import { markWorkspaceLifecycleActive } from "./workspaceLifecycle";
import { savePersistedSettings, toPersistedSettings } from "./settingsStore";

export interface SyncSessionTabEffectInput {
  activeTab: TabState | undefined | null;
  isChatHttpActive: boolean;
  chatHttpRailVisible: boolean;
  activeContextId: ContextId;
  activeWorkspaceRoot: string | null;
  isSessionTabActive: boolean;
  selectedSessionId: string | null;
  lastChatScopeKey: string | null;
  ensureChatHttpSessionTab: () => void;
  restoreWorkspaceSession: (
    workspaceRoot: string,
    options?: { skipOpencodeReconcile?: boolean },
  ) => Promise<void>;
  setLastChatScopeKey: (key: string | null) => void;
}

export function syncSessionTabEffect(input: SyncSessionTabEffectInput): void {
  const {
    activeTab,
    isChatHttpActive,
    chatHttpRailVisible,
    activeContextId,
    activeWorkspaceRoot,
    isSessionTabActive,
    selectedSessionId,
    lastChatScopeKey,
    ensureChatHttpSessionTab,
    restoreWorkspaceSession,
    setLastChatScopeKey,
  } = input;

  if (activeTab && isSessionTab(activeTab) && !isChatHttpActive) {
    if (chatStore.getActiveSessionId() !== activeTab.sessionId) {
      chatStore.setActiveSessionId(activeTab.sessionId);
      appState.setLastActiveSessionId(activeTab.sessionId);
      void chatStore.runAccessPreflight();
    }
  }

  if (isChatHttpActive && !chatHttpRailVisible) {
    appState.switchContext("notepad");
    return;
  }

  if (isChatHttpActive) {
    selectedSessionId;
    ensureChatHttpSessionTab();
  }

  if (activeContextId === CHAT_HTTP_CONTEXT_ID) {
    if (lastChatScopeKey !== CHAT_HTTP_CONTEXT_ID) {
      if (lastChatScopeKey !== null) {
        chatStore.cancelAllGenerations(lastChatScopeKey);
      }
      setLastChatScopeKey(CHAT_HTTP_CONTEXT_ID);
      chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
      void chatStore.loadWorkspaceSessions(CHAT_HTTP_CONTEXT_ID).then(() => {
        ensureChatHttpSessionTab();
      });
    } else {
      ensureChatHttpSessionTab();
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
    const restoreStartedAt = Date.now();
    void restoreWorkspaceSession(normalizedWorkspaceRoot, {
      skipOpencodeReconcile: !isSessionTabActive,
    })
      .then(() =>
        logDiagnostic({
          level: "info",
          source: "frontend",
          timestamp: new Date().toISOString(),
          message: "workspace switch restore complete",
          metadata: {
            workspaceRoot: normalizedWorkspaceRoot,
            durationMs: Date.now() - restoreStartedAt,
            isSessionTabActive,
            skipOpencodeReconcile: !isSessionTabActive,
          },
        }),
      )
      .catch(() => {
        void logDiagnostic({
          level: "warn",
          source: "frontend",
          timestamp: new Date().toISOString(),
          message: "workspace switch restore failed",
          metadata: {
            workspaceRoot: normalizedWorkspaceRoot,
            durationMs: Date.now() - restoreStartedAt,
          },
        });
        if (isSessionTabActive) {
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
  selectedSessionId: string | null;
  sessionLastActiveSessionId: string | null | undefined;
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
    selectedSessionId,
    sessionLastActiveSessionId,
    selectedTabId,
    lastSelectedTabId,
    onTabActivated,
    setLastSelectedTabId,
  } = input;

  if (runtimeReady && activeWorkspaceRoot) {
    const chatActiveId = selectedSessionId;
    const sessionLastActive = sessionLastActiveSessionId ?? null;
    if (chatActiveId !== sessionLastActive) {
      appState.setLastActiveSessionId(chatActiveId);
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
      defaultMarkdownViewMode: snapshot.settings.defaultMarkdownViewMode,
      opencode: snapshot.settings.opencode,
      chatHttp: snapshot.settings.chatHttp,
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
  /** M13.5 — gate automatic sidecar-mode health work on session-tab active. */
  isSessionTabActive: boolean;
  opencodeEnabled: boolean;
  opencodeMode: import("../domain/contracts").OpencodeTransportMode;
  opencodeBaseUrl: string;
  /** M14-T4 — current sidecar port from settings; forwarded to the sidecar
   * on the next attach. Not used by the URL-mode probe path. */
  opencodeSidecarPort: number;
  serverPassword?: string;
  setOpencodeHealth: (patch: Partial<import("../domain/contracts").OpencodeHealthState>) => void;
}

const URL_HEALTH_TIMEOUT_MS = 10_000;
const SIDECAR_STATUS_TIMEOUT_MS = 7_000;

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
    isSessionTabActive,
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

  // URL mode: probe the configured server (no spawn). Skip when not on a
  // session tab to avoid probe storms on file/editor activity; the URL is
  // not a local sidecar so there's no spawn risk, but the probe itself
  // consumes time and can race with editor saves.
  if (opencodeMode === "url") {
    if (!isSessionTabActive) {
      return;
    }
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

  // Sidecar mode (M13.5): no attach on workspace activation. Only probe the
  // running sidecar (status-only), and only when the user is on a session
  // tab — the sidecar is meant to serve sessions, not file editing. The
  // sidecar is started lazily by Send or explicit Settings actions.
  if (!isSessionTabActive) {
    return;
  }

  // Respect circuit breaker: don't keep poking the sidecar after a hard
  // failure — leave the existing `error` health in place until the user
  // retries via Settings → Check connection or toggles OpenCode.
  if (isOpencodeSidecarBlocked()) {
    return;
  }

  setOpencodeHealth({
    status: "checking",
    source: "sidecar",
    checkedAt: new Date().toISOString(),
    lastErrorMessage: null,
  });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("OpenCode sidecar status check timed out after 7s")),
      SIDECAR_STATUS_TIMEOUT_MS,
    ),
  );
  void Promise.race([getOpencodeSidecarStatus(), timeout])
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
          : error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to read OpenCode sidecar status.";
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
  /** M14-T4 — current sidecar port; forwarded to `ensureOpencodeSidecar`
   * so a settings-driven port change re-attaches on the new port. */
  opencodeSidecarPort: number;
  serverPassword?: string;
  activeWorkspaceRoot?: string | null;
  setOpencodeHealth: (patch: Partial<import("../domain/contracts").OpencodeHealthState>) => void;
}): void {
  const {
    opencodeEnabled,
    opencodeMode,
    opencodeBaseUrl,
    opencodeSidecarPort,
    activeWorkspaceRoot,
    setOpencodeHealth,
  } = input;
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
    // Settings intent — may spawn the sidecar (explicit user retry after a
    // hard failure clears the circuit breaker; first-time start clears
    // it on success).
    if (!activeWorkspaceRoot) {
      setOpencodeHealth({
        status: "error",
        source: "sidecar",
        checkedAt: new Date().toISOString(),
        lastErrorMessage:
          "Open a workspace folder before checking the sidecar connection.",
      });
      return;
    }
    void ensureOpencodeSidecar(
      {
        intent: "settings",
        directory: activeWorkspaceRoot,
        port: opencodeSidecarPort,
      },
      {
        setOpencodeHealth: (patch) =>
          setOpencodeHealth({
            status: patch.status,
            source: "sidecar",
            checkedAt: patch.checkedAt,
            lastErrorMessage: patch.lastErrorMessage,
          }),
      },
    ).catch(() => {
      // ensure already published health; fall through to a final probe so
      // the status pill reflects the latest settled state.
      void probeSidecarStatusAfterRefresh(setOpencodeHealth);
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

async function probeSidecarStatusAfterRefresh(
  setOpencodeHealth: (patch: Partial<import("../domain/contracts").OpencodeHealthState>) => void,
): Promise<void> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("OpenCode sidecar status check timed out after 7s")),
        SIDECAR_STATUS_TIMEOUT_MS,
      ),
    );
    const status = await Promise.race([getOpencodeSidecarStatus(), timeout]);
    setOpencodeHealth({
      status: healthFromSidecarStatus(status.health),
      source: "sidecar",
      checkedAt: new Date().toISOString(),
      lastErrorMessage: status.lastError?.message ?? null,
    });
  } catch {
    // Status probe already failed; ensure published the failure. No-op.
  }
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
  isSessionTabActive: boolean;
  activeWorkspaceRoot: string | null;
  isChatHttpActive: boolean;
}

export function syncChatAccessMonitorEffect(input: SyncChatAccessMonitorEffectInput): void {
  const { runtimeReady, isSessionTabActive, activeWorkspaceRoot, isChatHttpActive } = input;
  if (!runtimeReady) {
    return;
  }
  syncChatAccessMonitor(isSessionTabActive && Boolean(activeWorkspaceRoot) && !isChatHttpActive);
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

const ACTIVE_FILE_TREE_EXPAND_DEBOUNCE_MS = 75;
let activeFileTreeExpandTimer: ReturnType<typeof setTimeout> | null = null;
let pendingActiveFileExpandRequest:
  | {
      key: string;
      workspaceRoot: string;
      documentPath: string;
      projectTreeController: ProjectTreeController;
    }
  | null = null;
let lastAppliedActiveFileExpandKey: string | null = null;

export function resetAppShellEffectsForTests(): void {
  if (activeFileTreeExpandTimer) {
    clearTimeout(activeFileTreeExpandTimer);
    activeFileTreeExpandTimer = null;
  }
  pendingActiveFileExpandRequest = null;
  lastAppliedActiveFileExpandKey = null;
}

export function syncActiveFileTreeExpandEffect(input: SyncActiveFileTreeExpandEffectInput): void {
  const { activeDocumentPath, isChatHttpActive, activeWorkspaceRoot, projectTreeController } = input;
  if (!activeDocumentPath || !activeWorkspaceRoot || isChatHttpActive) {
    if (activeFileTreeExpandTimer) {
      clearTimeout(activeFileTreeExpandTimer);
      activeFileTreeExpandTimer = null;
    }
    pendingActiveFileExpandRequest = null;
    return;
  }
  const key = `${activeWorkspaceRoot}::${activeDocumentPath}`;
  if (key === lastAppliedActiveFileExpandKey || pendingActiveFileExpandRequest?.key === key) {
    return;
  }
  pendingActiveFileExpandRequest = {
    key,
    workspaceRoot: activeWorkspaceRoot,
    documentPath: activeDocumentPath,
    projectTreeController,
  };
  if (activeFileTreeExpandTimer) {
    clearTimeout(activeFileTreeExpandTimer);
  }
  activeFileTreeExpandTimer = setTimeout(() => {
    activeFileTreeExpandTimer = null;
    const request = pendingActiveFileExpandRequest;
    pendingActiveFileExpandRequest = null;
    if (!request || request.key === lastAppliedActiveFileExpandKey) {
      return;
    }
    lastAppliedActiveFileExpandKey = request.key;
    void request.projectTreeController.ensureExpandedForActiveFile(
      request.workspaceRoot,
      request.documentPath,
    );
  }, ACTIVE_FILE_TREE_EXPAND_DEBOUNCE_MS);
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
