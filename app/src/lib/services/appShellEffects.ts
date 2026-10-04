/**
 * App shell reactive side effects extracted from +page.svelte.
 *
 * Effect ordering constraints:
 * 1. Session/chat scope (syncSessionTabEffect) should run before session persistence
 *    so lastActiveAgentId reflects the current agent tab selection.
 * 2. Project tree watcher (syncProjectTreeWatcherEffect) depends on runtimeReady
 *    and activeWorkspaceRoot (not tab/session churn); load root before starting
 *    the watcher. Memoized so redundant effect re-runs are no-ops.
 * 3. Settings persistence (syncSettingsPersistenceEffect) is independent but
 *    shares the same snapshot read as session persistence — keep both in the
 *    same $effect wrapper to avoid duplicate debounced writes.
 * 4. External file watcher (syncExternalFileWatcherEffect) requires runtimeReady
 *    and the sync function injected by startAppShellRuntime. Memoized on the
 *    watch-flag + watched-paths key so non-path UI updates are no-ops.
 * 5. Active file tree expand (syncActiveFileTreeExpandEffect) runs after the
 *    project tree root is loaded for the current workspace.
 *
 * Untitled document titles are refreshed via scheduleUntitledTitleRefresh
 * (editor callback), not a reactive effect in this module.
 */

import type { AppDomainState, ContextId, TabState } from "../domain/contracts";
import { isSessionTab } from "../domain/contracts";
import { appState } from "../state/appState";
import { chatStore } from "../state/chatStore";
import { normalizePathSync } from "./diskFingerprint";
import { syncProjectTreeWatcher } from "./fileWatcher";
import type { createProjectTreeController } from "./projectTreeController";

type ProjectTreeController = ReturnType<typeof createProjectTreeController>;
import { ensureWorkspaceReadAccess } from "./fileSystem";
import { logDiagnostic } from "./logging";
import { elapsedMs, logPerfTiming, nowMs } from "./perfDiagnostics";
import { scheduleSessionPersistence } from "./sessionManager";
import { markWorkspaceLifecycleActive } from "./workspaceLifecycle";
import {
  savePersistedSettings,
  toPersistedSettings,
  type PersistedSettings,
} from "./settingsStore";
import { externalFileWatcherSyncKey } from "./appShellHelpers";
import { settingsPersistenceFingerprint } from "../state/appStateSelectors";

export interface SyncSessionTabEffectInput {
  activeTab: TabState | undefined | null;
  activeContextId: ContextId;
  activeWorkspaceRoot: string | null;
  isSessionTabActive: boolean;
  lastChatScopeKey: string | null;
  restoreWorkspaceSession: (
    workspaceRoot: string,
    options?: { preferCachedIndex?: boolean },
  ) => Promise<void>;
  setLastChatScopeKey: (key: string | null) => void;
  /**
   * P03-08-29(b): when AI is disabled, the workspace chat scope is never
   * user-reachable (session tabs are hidden), so creating an empty per-workspace
   * chat slice on every switch is pure waste that keeps the chat emit fan-out
   * wired.
   */
  sessionsEnabled: boolean;
}

export function syncSessionTabEffect(input: SyncSessionTabEffectInput): void {
  const {
    activeTab,
    activeWorkspaceRoot,
    isSessionTabActive,
    lastChatScopeKey,
    restoreWorkspaceSession,
    setLastChatScopeKey,
    sessionsEnabled,
  } = input;

  if (activeTab && isSessionTab(activeTab)) {
    if (chatStore.getActiveSessionId() !== activeTab.sessionId) {
      chatStore.setActiveSessionId(activeTab.sessionId);
      appState.setLastActiveSessionId(activeTab.sessionId);
      void chatStore.ensureSessionThreadHydrated(activeTab.sessionId).finally(() => {
        void chatStore.runAccessPreflight();
      });
    }
  }

  if (!activeWorkspaceRoot) {
    if (lastChatScopeKey !== null) {
      chatStore.cancelAllGenerations(lastChatScopeKey);
      setLastChatScopeKey(null);
    }
    chatStore.setActiveWorkspaceRoot(null);
    return;
  }

  // P03-08-29(b): with AI disabled, the workspace chat scope is unreachable
  // (session tabs are hidden) and creating an empty per-workspace slice on
  // every switch only keeps the chat emit fan-out wired for no user benefit.
  // Cancel any stale scope and stop — re-enabling AI re-arms the full path.
  if (!sessionsEnabled) {
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
    const restoreStartedAt = nowMs();
    void restoreWorkspaceSession(normalizedWorkspaceRoot, {
      preferCachedIndex: !isSessionTabActive,
    })
      .then(() =>
        logPerfTiming("workspace switch restore complete", {
          metric: "workspace.switchRestore",
          durationMs: elapsedMs(restoreStartedAt),
          workspaceRoot: normalizedWorkspaceRoot,
          isSessionTabActive,
          preferCachedIndex: !isSessionTabActive,
          ok: true,
        }),
      )
      .catch(() => {
        void logPerfTiming("workspace switch restore failed", {
          metric: "workspace.switchRestore",
          durationMs: elapsedMs(restoreStartedAt),
          workspaceRoot: normalizedWorkspaceRoot,
          isSessionTabActive,
          preferCachedIndex: !isSessionTabActive,
          ok: false,
        });
        void logDiagnostic({
          level: "warn",
          source: "frontend",
          timestamp: new Date().toISOString(),
          message: "workspace switch restore failed",
          metadata: {
            workspaceRoot: normalizedWorkspaceRoot,
            durationMs: elapsedMs(restoreStartedAt),
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
    scheduleSessionPersistence(appState.getSnapshot(), currentWindowId);
  }
}

export interface SyncSettingsPersistenceEffectInput {
  runtimeReady: boolean;
  currentWindowId: string;
  snapshot: AppDomainState;
}

let lastSettingsPersistenceFingerprint: string | null = null;

/**
 * Settings writes are debounced (trailing edge) so high-frequency updates —
 * e.g. a range-slider firing `setFontSettings` per `oninput` — collapse into
 * one write instead of dozens of concurrent writes to the same file.
 * `savePersistedSettings` additionally serializes and atomically replaces the
 * file, so even overlapping writers cannot tear settings.json.
 */
const SETTINGS_PERSIST_DEBOUNCE_MS = 300;
let settingsPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersistedSettings: PersistedSettings | null = null;

function schedulePersistSettings(settings: PersistedSettings): void {
  pendingPersistedSettings = settings;
  if (settingsPersistTimer) {
    clearTimeout(settingsPersistTimer);
  }
  settingsPersistTimer = setTimeout(() => {
    settingsPersistTimer = null;
    const toWrite = pendingPersistedSettings;
    pendingPersistedSettings = null;
    if (toWrite) {
      void savePersistedSettings(toWrite);
    }
  }, SETTINGS_PERSIST_DEBOUNCE_MS);
}

/** Write any pending debounced settings immediately (window close / quit path). */
export async function flushSettingsPersistence(): Promise<void> {
  if (settingsPersistTimer) {
    clearTimeout(settingsPersistTimer);
    settingsPersistTimer = null;
  }
  const toWrite = pendingPersistedSettings;
  pendingPersistedSettings = null;
  if (toWrite) {
    await savePersistedSettings(toWrite);
  }
}

export function syncSettingsPersistenceEffect(input: SyncSettingsPersistenceEffectInput): void {
  const { runtimeReady, currentWindowId, snapshot } = input;
  if (!runtimeReady || !currentWindowId) {
    return;
  }
  const fingerprint = settingsPersistenceFingerprint(snapshot);
  if (fingerprint === lastSettingsPersistenceFingerprint) {
    return;
  }
  lastSettingsPersistenceFingerprint = fingerprint;
  schedulePersistSettings(
    toPersistedSettings({
      wrapLines: snapshot.editor.wrapLines,
      zoomPercent: snapshot.editor.zoomPercent,
      externalFiles: snapshot.settings.externalFiles,
      decoratePlaintextSymbols: snapshot.settings.decoratePlaintextSymbols,
      coloredProjectFileIcons: snapshot.settings.coloredProjectFileIcons,
      showMinimap: snapshot.settings.showMinimap,
      showFoldGutter: snapshot.settings.showFoldGutter,
      autoClosePairs: snapshot.settings.autoClosePairs,
      autoSuggest: snapshot.settings.autoSuggest,
      defaultMarkdownViewMode: snapshot.settings.defaultMarkdownViewMode,
      restrictFilesToContext: snapshot.settings.restrictFilesToContext,
      sessionsEnabled: snapshot.settings.sessionsEnabled ?? true,
      warnConcurrentWriters: snapshot.settings.warnConcurrentWriters,
      gitIntegration: snapshot.settings.gitIntegration,
      logSettings: snapshot.settings.logSettings,
      markdownSnippets: snapshot.settings.markdownSnippets,
      commandBindingOverrides: snapshot.settings.commandBindingOverrides,
      fontSettings: snapshot.settings.fontSettings,
      soundSettings: snapshot.settings.soundSettings,
      osNotificationSettings: snapshot.settings.osNotificationSettings,
      showHiddenFiles: snapshot.settings.showHiddenFiles,
    }),
  );
}

export interface SyncProjectTreeWatcherEffectInput {
  runtimeReady: boolean;
  activeWorkspaceRoot: string | null;
  /**
   * Roots of all open workspaces, so the recursive watcher can keep every open
   * root watched (a switch is then a diff, not a full unwatch+rewatch). When
   * omitted, only the active workspace root is watched.
   */
  openWorkspaceRoots?: readonly string[];
  projectTreeController: ProjectTreeController;
  loadProjectTreeRoot: () => Promise<void>;
  /**
   * Quiet revalidation of the tree that a workspace switch just brought up.
   * Entering a workspace served from the controller's in-memory cache shows a
   * snapshot taken when it was last active, so it is re-listed in the
   * background; a cold load is already authoritative and the controller's own
   * throttle drops the redundant pass.
   */
  revalidateProjectTree?: () => Promise<void>;
}

/**
 * Memoized project-tree sync. Root load runs on workspace-root transition;
 * watcher sync runs when entering an active workspace with runtimeReady.
 * Tab/session churn that re-invokes this effect is a no-op.
 */
let lastProjectTreeRootKey: string | null = null;
let lastProjectTreeWatcherKey: string | null = null;

export function syncProjectTreeWatcherEffect(input: SyncProjectTreeWatcherEffectInput): void {
  const {
    runtimeReady,
    activeWorkspaceRoot,
    openWorkspaceRoots,
    projectTreeController,
    loadProjectTreeRoot,
    revalidateProjectTree,
  } = input;

  // Gate on workspace presence — not tab/session selection.
  if (!activeWorkspaceRoot) {
    if (lastProjectTreeWatcherKey === "inactive") {
      return;
    }
    lastProjectTreeWatcherKey = "inactive";
    if (!activeWorkspaceRoot) {
      // Left workspace entirely — allow a fresh root load on next entry.
      lastProjectTreeRootKey = null;
    }
    void syncProjectTreeWatcher([]);
    projectTreeController.clearFilesystemChangeDebounce();
    return;
  }

  const rootKey = normalizePathSync(activeWorkspaceRoot);
  if (rootKey !== lastProjectTreeRootKey) {
    lastProjectTreeRootKey = rootKey;
    void loadProjectTreeRoot().then(() => {
      // Only meaningful when the root came back from the controller cache; a
      // cold load seeds the revalidation throttle, so this resolves to a no-op.
      void revalidateProjectTree?.();
    });
  }

  if (runtimeReady) {
    // Watch every open workspace root so a switch is a diff (add/remove the
    // changed root) rather than a full unwatch+rewatch of the active root.
    // Sorting the roots makes the key stable across switches (the same set of
    // open roots yields the same key regardless of which is active).
    const allRoots = openWorkspaceRoots
      ? [...openWorkspaceRoots].map((root) => normalizePathSync(root)).sort()
      : [rootKey];
    const watcherKey = allRoots.join("\0");
    if (lastProjectTreeWatcherKey !== watcherKey) {
      lastProjectTreeWatcherKey = watcherKey;
      void syncProjectTreeWatcher(allRoots);
    }
  }
}

export interface SyncExternalFileWatcherEffectInput {
  runtimeReady: boolean;
  snapshot: AppDomainState;
  syncExternalFileWatcher: ((state: AppDomainState) => Promise<void>) | null;
}

/**
 * Memoized external file-watcher sync. Recomputes watched paths only when the
 * watch flag or open file paths change; redundant effect re-runs are no-ops.
 */
let lastExternalFileWatcherSyncKey: string | null = null;

export function syncExternalFileWatcherEffect(input: SyncExternalFileWatcherEffectInput): void {
  const { runtimeReady, snapshot, syncExternalFileWatcher } = input;
  if (!runtimeReady || !syncExternalFileWatcher) {
    // Allow a fresh sync after the next runtimeReady / sync-fn injection.
    lastExternalFileWatcherSyncKey = null;
    return;
  }
  const syncKey = externalFileWatcherSyncKey(snapshot);
  if (syncKey === lastExternalFileWatcherSyncKey) {
    return;
  }
  lastExternalFileWatcherSyncKey = syncKey;
  void syncExternalFileWatcher(snapshot);
}

export interface SyncActiveFileTreeExpandEffectInput {
  activeDocumentPath: string | null;
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
  lastProjectTreeRootKey = null;
  lastProjectTreeWatcherKey = null;
  lastExternalFileWatcherSyncKey = null;
  lastWorkspaceFileCatalogKey = null;
  lastOpenWorkspaceCatalogRoots = new Set();
  lastSettingsPersistenceFingerprint = null;
  if (settingsPersistTimer) {
    clearTimeout(settingsPersistTimer);
    settingsPersistTimer = null;
  }
  pendingPersistedSettings = null;
}

export function syncActiveFileTreeExpandEffect(input: SyncActiveFileTreeExpandEffectInput): void {
  const { activeDocumentPath, activeWorkspaceRoot, projectTreeController } = input;
  if (!activeDocumentPath || !activeWorkspaceRoot) {
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

/**
 * Mark the given active document path as already "revealed" so the next run of
 * {@link syncActiveFileTreeExpandEffect} (debounced 75 ms) treats it as applied
 * and skips expanding the tree to that file. Used after an in-app file move
 * (drag-drop): relocating the active document rewrites its path, which would
 * otherwise trigger the auto-reveal and expand folders down to the new
 * location — desirable when *opening* a file, not when *moving* one you
 * already have open.
 */
export function markActiveFileTreeExpandApplied(
  workspaceRoot: string,
  documentPath: string,
): void {
  lastAppliedActiveFileExpandKey = `${workspaceRoot}::${documentPath}`;
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

export interface SyncWorkspaceFileCatalogEffectInput {
  activeWorkspaceRoot: string | null;
  /** Roots still open in the session; catalogs for missing roots are disposed. */
  openWorkspaceRoots?: readonly string[];
  registry: {
    setActiveRoot: (root: string | null) => unknown;
    disposeRoot?: (root: string) => void;
  };
}

let lastWorkspaceFileCatalogKey: string | null = null;
let lastOpenWorkspaceCatalogRoots = new Set<string>();

/**
 * Keep the workspace file catalog scoped to the active workspace.
 * Clears on workspace leave / chat-http overlay.
 * Disposes catalogs whose workspace root is no longer open so closed
 * workspaces do not retain enumeration state forever.
 */
export function syncWorkspaceFileCatalogEffect(input: SyncWorkspaceFileCatalogEffectInput): void {
  const { activeWorkspaceRoot, registry } = input;
  if (registry.disposeRoot && input.openWorkspaceRoots !== undefined) {
    const openRoots = new Set(
      input.openWorkspaceRoots.map((root) => normalizePathSync(root)),
    );
    for (const root of lastOpenWorkspaceCatalogRoots) {
      if (!openRoots.has(root)) {
        registry.disposeRoot(root);
      }
    }
    lastOpenWorkspaceCatalogRoots = openRoots;
  }

  if (!activeWorkspaceRoot) {
    if (lastWorkspaceFileCatalogKey === "inactive") {
      return;
    }
    lastWorkspaceFileCatalogKey = "inactive";
    registry.setActiveRoot(null);
    return;
  }
  const rootKey = normalizePathSync(activeWorkspaceRoot);
  if (lastWorkspaceFileCatalogKey === rootKey) {
    return;
  }
  lastWorkspaceFileCatalogKey = rootKey;
  registry.setActiveRoot(activeWorkspaceRoot);
}
