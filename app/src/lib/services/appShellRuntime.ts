import { emit, emitTo, listen, TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { AppCommandId, AppDomainState } from "../domain/contracts";
import { appState, setThemeSaveErrorNotifier } from "../state/appState";
import { subscribeSystemColorScheme } from "../state/appState/themeController";
import { applyFontSettingsToDom } from "../state/appState/fontSettingsSlice";
import { chatStore } from "../state/chatStore";
import { initializeLogging, logDiagnostic } from "./logging";
import { elapsedMs, logPerfTiming, nowMs } from "./perfDiagnostics";
import { listenForRecentFilesChanges } from "./recentFilesSync";
import {
  initializeAppMenu,
  refreshOpenRecentMenu,
  shouldInitializeAppMenu,
} from "../commands/registry";
import { queueOpenRecentPath } from "./appMenu";
import { refreshDockMenu } from "./dockMenu";
import { getErrorMessage } from "../commands/commandErrors";
import {
  WINDOW_EVENT_ACTIVATE_FILE,
  WINDOW_EVENT_SELECT_TAB_FOR_PATH,
  WINDOW_EVENT_MERGE_TAB,
  WINDOW_EVENT_MERGE_TAB_ACK,
  WINDOW_EVENT_TRANSFER_TAB,
  WINDOW_EVENT_WINDOW_READY,
  type MergeTabAckPayload,
  type MergeTabPayload,
  type TabTransferPayload,
  markWindowActive,
} from "./windowManager";
import {
  MAIN_WINDOW_ID,
  pruneStaleWindowSessionEntries,
  restoreWindowSession,
} from "./sessionManager";
import { applyWindowBounds, readWindowBounds } from "./windowBounds";
import {
  claimOpenFile,
  pruneOpenFileRegistryWindows,
  releaseAllOpenFilesForWindow,
  syncOpenFileRegistryForWindow,
  transferOpenFileClaim,
} from "./openFileRegistry";
import {
  loadPersistedSettings,
  toExternalFilesSettings,
} from "./settingsStore";
import {
  cancelStartupExternalChecks,
  initializeDocumentDiskState,
  runFocusExternalChecks,
  runStartupExternalChecks,
  runWatcherExternalCheck,
  shouldSyncFileWatcher,
} from "./externalFileChanges";
import {
  clearFileWatcherPaths,
  FILE_CHANGED_EVENT,
  syncFileWatcherPaths,
  syncProjectTreeWatcher,
  type FileWatcherEventKind,
} from "./fileWatcher";
import { stopOpencodeSidecar } from "./opencodeSidecar";
import { selectTabForNormalizedPath } from "./openFileGate";
import { normalizePathSync } from "./diskFingerprint";
import { ensureWorkspaceReadAccess } from "./fileSystem";
import { readConsoleHeightPreference } from "./consoleTabPrefs";
import { externalFileWatcherSyncKey, truncateWatchedPaths, watchedPathsFromState } from "./appShellHelpers";
import { loadWorkspacePreferences } from "./workspacePreferences";
import { openDroppedPath } from "./openDroppedPath";
import type {
  OpenActivePathResult,
  OpenPathActivationOptions,
} from "./openActivePath";
import { fileDragActive } from "./fileDragOverlay";

const APP_EVENT_OPENED_PATHS = "spec-ops/app/opened-paths";
const DOCK_NEW_WINDOW_EVENT = "spec-ops/dock/new-window";
const DOCK_OPEN_RECENT_EVENT = "spec-ops/dock/open-recent";
const DOCK_CLEAR_RECENT_EVENT = "spec-ops/dock/clear-recent";

const FILE_WATCHER_KIND_VALUES = new Set<FileWatcherEventKind>([
  "create",
  "remove",
  "modify",
  "rename",
  "other",
]);

/**
 * Normalize the raw payload kind to a known {@link FileWatcherEventKind}.
 * Falls back to `other` when missing or unrecognized so catalog invalidation
 * debounces safely instead of misclassifying the event.
 */
export function normalizeFileWatcherKind(raw: unknown): FileWatcherEventKind {
  if (typeof raw === "string" && FILE_WATCHER_KIND_VALUES.has(raw as FileWatcherEventKind)) {
    return raw as FileWatcherEventKind;
  }
  return "other";
}

export interface AppShellRuntimeOptions {
  notify: (message: string) => void;
  runCommand: (commandId: AppCommandId) => void;
  openAndActivatePath: (
    path: string,
    options?: OpenPathActivationOptions,
  ) => Promise<OpenActivePathResult | void>;
  consumeOpenedPaths: (paths: string[]) => Promise<void>;
  restoreWorkspaceSession: (
    normalizedRoot: string,
    options?: { preferCachedIndex?: boolean },
  ) => Promise<void>;
  loadProjectTreeRoot: () => Promise<void>;
  onFilesystemChange?: (path: string, kind: FileWatcherEventKind) => void;
  syncProjectTreeWatcher?: (roots: readonly string[]) => Promise<void>;
  setConsoleHeightPx: (heightPx: number) => void;
}

export interface AppShellRuntimeHandle {
  windowId: string;
  cleanup: () => void;
  syncExternalFileWatcher: (state: AppDomainState) => Promise<void>;
}

let activeRuntimeCleanup: (() => void) | null = null;

/** Disposes any prior runtime listeners and registers the new cleanup handle. */
export function handoffAppShellRuntimeCleanup(next: () => void): void {
  activeRuntimeCleanup?.();
  activeRuntimeCleanup = next;
}

/**
 * Start the window runtime, releasing every partial registration if startup fails.
 *
 * Startup registers ~15 Tauri event listeners before the returned `cleanup` closure
 * exists. Without this wrapper a failure part-way through (a rejected `invoke`, a
 * listener registration error) leaves those listeners attached with no handle to
 * release them, so a retry or a re-mount ends up with two sets of handlers firing for
 * every filesystem change, dock action and routed file open.
 */
export async function startAppShellRuntime(
  options: AppShellRuntimeOptions,
): Promise<AppShellRuntimeHandle> {
  activeRuntimeCleanup?.();
  activeRuntimeCleanup = null;

  const cleanupCallbacks: UnlistenFn[] = [];
  try {
    return await startAppShellRuntimeInner(options, cleanupCallbacks);
  } catch (error: unknown) {
    for (const unlisten of cleanupCallbacks) {
      try {
        unlisten();
      } catch {
        // Best-effort teardown: one failed unlisten must not mask the startup error
        // or skip the remaining releases.
      }
    }
    void clearFileWatcherPaths();
    throw error;
  }
}

async function startAppShellRuntimeInner(
  options: AppShellRuntimeOptions,
  cleanupCallbacks: UnlistenFn[],
): Promise<AppShellRuntimeHandle> {
  const currentWindow = getCurrentWebviewWindow();
  const windowId = currentWindow.label;
  let runtimeReady = false;
  let lastWatcherSyncKey = "";
  let windowBoundsTimer: ReturnType<typeof setTimeout> | null = null;
  let applyingWindowBounds = false;

  async function syncExternalFileWatcher(state: AppDomainState): Promise<void> {
    if (!runtimeReady) {
      return;
    }
    const syncKey = externalFileWatcherSyncKey(state);
    if (syncKey === lastWatcherSyncKey) {
      return;
    }
    lastWatcherSyncKey = syncKey;

    if (!shouldSyncFileWatcher(state.settings.externalFiles)) {
      await clearFileWatcherPaths();
      return;
    }
    await syncFileWatcherPaths(truncateWatchedPaths(watchedPathsFromState(state)));
  }

  function scheduleWindowBoundsPersistence(): void {
    if (applyingWindowBounds) {
      return;
    }
    if (windowBoundsTimer) {
      clearTimeout(windowBoundsTimer);
    }
    windowBoundsTimer = setTimeout(() => {
      void (async () => {
        const bounds = await readWindowBounds(getCurrentWebviewWindow());
        appState.setWindowBounds(bounds);
      })();
    }, 400);
  }

  async function openDroppedPaths(paths: string[]): Promise<void> {
    for (const droppedPath of paths) {
      await openDroppedPath(droppedPath, options.openAndActivatePath, options.notify);
    }
  }

  // Register the drag-drop listener before everything else: a failure in any
  // later listener registration tears the whole runtime down, and file drops
  // are the one input channel whose loss is completely invisible to the user.
  cleanupCallbacks.push(
    await currentWindow.onDragDropEvent(async (event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        fileDragActive.set(true);
        return;
      }
      fileDragActive.set(false);
      if (payload.type === "drop") {
        await openDroppedPaths(payload.paths);
      }
    }),
  );

  // Register window/dock listeners sequentially so each unlisten is pushed
  // into cleanupCallbacks before the next IPC round-trip. A batch Promise.all
  // dropped already-resolved handles when one listen rejected (C8).
  const registerListenersStartedAt = nowMs();
  cleanupCallbacks.push(
    await listen<TabTransferPayload>(
      WINDOW_EVENT_TRANSFER_TAB,
      async (event) => {
        const documentId = appState.openTransferredTab(event.payload);
        if (event.payload.filePath && documentId) {
          const conflict = event.payload.sourceWindowId
            ? await transferOpenFileClaim(
                event.payload.filePath,
                event.payload.sourceWindowId,
                windowId,
                documentId,
              )
            : await claimOpenFile(event.payload.filePath, windowId, documentId);
          if (conflict) {
            throw new Error("The transferred file is already open in another window.");
          }
          await initializeDocumentDiskState(documentId, event.payload.filePath);
        }
      },
    ),
  );
  cleanupCallbacks.push(
    await listen<MergeTabPayload>(WINDOW_EVENT_MERGE_TAB, async (event) => {
      const { sourceWindowId, sourceTabId, ...payload } = event.payload;
      try {
        const documentId = appState.openTransferredTab(payload);
        if (payload.filePath && documentId) {
          const conflict = await transferOpenFileClaim(
            payload.filePath,
            sourceWindowId,
            windowId,
            documentId,
          );
          if (conflict) {
            throw new Error("The transferred file is already open in another window.");
          }
          await initializeDocumentDiskState(documentId, payload.filePath);
        }
        await emitTo<MergeTabAckPayload>(sourceWindowId, WINDOW_EVENT_MERGE_TAB_ACK, {
          sourceTabId,
          ok: true,
        });
      } catch (error: unknown) {
        try {
          await emitTo<MergeTabAckPayload>(sourceWindowId, WINDOW_EVENT_MERGE_TAB_ACK, {
            sourceTabId,
            ok: false,
            error: getErrorMessage(error, "Failed to open transferred tab."),
          });
        } catch {
          // Source will time out and keep the tab.
        }
      }
    }),
  );
  cleanupCallbacks.push(
    await listen(DOCK_NEW_WINDOW_EVENT, () => {
      options.runCommand("app.newWindow");
    }),
  );
  cleanupCallbacks.push(
    await listen<{ path: string }>(DOCK_OPEN_RECENT_EVENT, (event) => {
      queueOpenRecentPath(event.payload.path);
    }),
  );
  cleanupCallbacks.push(
    await listen(DOCK_CLEAR_RECENT_EVENT, () => {
      options.runCommand("file.clearRecentFiles");
    }),
  );
  await logPerfTiming("register window listeners", {
    metric: "startup.phase",
    label: "register-listeners",
    durationMs: elapsedMs(registerListenersStartedAt),
    windowId,
    ok: true,
  });

  await emit(WINDOW_EVENT_WINDOW_READY, { windowId });

  const startupStartedAt = nowMs();

  async function runSafeStartupPhase(phase: string, action: () => Promise<void>): Promise<void> {
    const phaseStartedAt = nowMs();
    try {
      await action();
      await logPerfTiming("app shell startup phase complete", {
        metric: "startup.phase",
        label: phase,
        durationMs: elapsedMs(phaseStartedAt),
        windowId,
        ok: true,
      });
    } catch (error: unknown) {
      await logPerfTiming(
        "app shell startup phase failed",
        {
          metric: "startup.phase",
          label: phase,
          durationMs: elapsedMs(phaseStartedAt),
          windowId,
          ok: false,
          error: getErrorMessage(error, String(error)),
        },
        "info",
      );
      await logDiagnostic({
        level: "warn",
        source: "frontend",
        timestamp: new Date().toISOString(),
        message: "app shell startup phase failed",
        metadata: {
          phase,
          durationMs: elapsedMs(phaseStartedAt),
          windowId,
          error: getErrorMessage(error, String(error)),
        },
      });
    }
  }

  await runSafeStartupPhase("load-settings", async () => {
    setThemeSaveErrorNotifier(options.notify);
    // Four independent file reads run concurrently: settings.json,
    // provider-secrets.json, the console-height preference, and the workspace
    // hide-from-rail preferences. Theme is loaded in a second step so the
    // legacy-theme migration fallback can reuse the already-parsed settings
    // instead of re-reading settings.json (only matters on first launch after
    // an upgrade that predates theme.json).
    const [persistedSettings, consoleHeightPx] = await Promise.all([
      loadPersistedSettings(),
      readConsoleHeightPreference(),
      loadWorkspacePreferences().catch(() => {}),
    ]);
    await appState.loadTheme({
      legacySettings: (persistedSettings as Record<string, unknown> | null) ?? null,
    });
    // Subscribe to OS color-scheme changes so `auto` theme mode re-resolves
    // when the user flips their system light/dark preference. Only re-applies
    // when mode === "auto" (dark/light are pinned); see applySystemPrefersDark.
    const unlistenSystemColorScheme = subscribeSystemColorScheme((prefersDark) => {
      appState.applySystemPrefersDark(prefersDark);
    });
    cleanupCallbacks.push(unlistenSystemColorScheme);
    if (persistedSettings) {
      appState.applyPersistedSettings({
        wrapLines: persistedSettings.wrapLines,
        zoomPercent: persistedSettings.zoomPercent,
        externalFiles: toExternalFilesSettings(persistedSettings),
        decoratePlaintextSymbols: persistedSettings.decoratePlaintextSymbols,
        showMinimap: persistedSettings.showMinimap,
        showFoldGutter: persistedSettings.showFoldGutter,
        autoClosePairs: persistedSettings.autoClosePairs,
        autoSuggest: persistedSettings.autoSuggest,
        defaultMarkdownViewMode: persistedSettings.defaultMarkdownViewMode,
        restrictFilesToContext: persistedSettings.restrictFilesToContext,
        opencode: persistedSettings.opencode,
        gitIntegration: persistedSettings.gitIntegration,
        commandBindingOverrides: persistedSettings.commandBindingOverrides,
        logSettings: persistedSettings.logSettings,
        markdownSnippets: persistedSettings.markdownSnippets,
        fontSettings: persistedSettings.fontSettings,
        soundSettings: persistedSettings.soundSettings,
        osNotificationSettings: persistedSettings.osNotificationSettings,
        showHiddenFiles: persistedSettings.showHiddenFiles,
      });
      // Reflect persisted font scales on the DOM immediately so the first
      // paint uses the user's chosen sizes (applyPersistedSettings does not
      // touch the DOM; only setFontSettings does at change time).
      applyFontSettingsToDom(persistedSettings.fontSettings);
    }
    options.setConsoleHeightPx(consoleHeightPx);
    await initializeLogging();
  });

  await runSafeStartupPhase("mark-window-active", async () => {
    // Skip the backup write here: this informational update is immediately
    // followed by restore-session, and the next real session mutation (e.g.
    // a tab change) will re-write both session.json and its backup. Skipping
    // the second write on the launch path removes one disk hop before ready.
    await markWindowActive(windowId, { skipBackup: true });
  });

  await runSafeStartupPhase("restore-session", async () => {
    // Clear crash-stale ownership before deduping the restored tabs. A stale
    // secondary-window owner must not make the main window discard its tab.
    const liveWindows = await getAllWebviewWindows();
    await pruneOpenFileRegistryWindows(liveWindows.map((entry) => entry.label));
    const restoredSession = await restoreWindowSession(windowId);
    if (!restoredSession) {
      return;
    }
    appState.applyWindowSession(restoredSession.snapshot, restoredSession.recentFiles);
    appState.normalizeUntitledTitles();
    await syncOpenFileRegistryForWindow(windowId, appState.getSnapshot());
    const restoredBounds = appState.getActiveSession().windowBounds;
    if (restoredBounds) {
      applyingWindowBounds = true;
      try {
        await applyWindowBounds(currentWindow, restoredBounds);
      } finally {
        applyingWindowBounds = false;
      }
    }
    options.notify("Session restored.");
  });

  await runSafeStartupPhase("restore-chat-scope", async () => {
    const restoredWorkspaceRoot = appState.getWorkspaceRoot();
    if (restoredWorkspaceRoot) {
      const normalizedRoot = normalizePathSync(restoredWorkspaceRoot);
      void ensureWorkspaceReadAccess(normalizedRoot);
      chatStore.setActiveWorkspaceRoot(normalizedRoot);
      await options.restoreWorkspaceSession(normalizedRoot, { preferCachedIndex: true });
      return;
    }
    chatStore.setActiveWorkspaceRoot(null);
  });

  // Flip the readiness gate as soon as the session and chat scope are restored.
  // The ~17 $effect blocks in +page.svelte are gated on `runtimeReady` and
  // self-guard against missing workspace root, so they can start running now.
  // The three phases below are visible-UI or correctness-deferrable work that
  // does not need to block the readiness gate:
  //   - initialize-app-menu: builds the macOS app menu (not needed for the
  //     webview to be interactive).
  //   - load-project-tree: also performed by syncProjectTreeWatcherEffect once
  //     runtimeReady flips, so this phase is best-effort prewarming.
  //   - startup-external-checks: stats open files for external changes; only
  //     the active tab is priority and the user cannot interact yet, so
  //     deferring it briefly is safe (it runs in the background here).
  runtimeReady = true;
  await logPerfTiming("app shell runtime ready", {
    metric: "startup.total",
    durationMs: elapsedMs(startupStartedAt),
    windowId,
  });

  void runSafeStartupPhase("initialize-app-menu", async () => {
    if (!shouldInitializeAppMenu(windowId)) {
      return;
    }
    const recentFiles = appState.getSnapshot().recentFiles;
    await initializeAppMenu(options.runCommand, recentFiles);
    await refreshDockMenu(recentFiles);
  });

  void runSafeStartupPhase("load-project-tree", async () => {
    await options.loadProjectTreeRoot();
  });

  void runSafeStartupPhase("prune-stale-window-sessions", async () => {
    // Main window only: it is the first window up on a fresh launch, so any
    // windows[...] entry without a live window is left over from a previous
    // run and — labels never being reused — can never be restored again.
    if (windowId !== MAIN_WINDOW_ID) {
      return;
    }
    const liveWindows = await getAllWebviewWindows();
    await pruneStaleWindowSessionEntries(liveWindows.map((w) => w.label));
  });

  void runSafeStartupPhase("startup-external-checks", async () => {
    await runStartupExternalChecks();
  });

  await runSafeStartupPhase("sync-file-watcher", async () => {
    await syncExternalFileWatcher(appState.getSnapshot());
  });

  const unlistenFocusChanged = await currentWindow.onFocusChanged(async ({ payload }) => {
    if (!payload) {
      return;
    }
    await markWindowActive(windowId);
    if (runtimeReady) {
      await runFocusExternalChecks();
    }
  });
  cleanupCallbacks.push(unlistenFocusChanged);

  const unlistenFileChanged = await listen<{ path: string; kind?: string }>(
    FILE_CHANGED_EVENT,
    async (event) => {
      if (!runtimeReady) {
        return;
      }
      const kind = normalizeFileWatcherKind(event.payload.kind);
      options.onFilesystemChange?.(event.payload.path, kind);
      await runWatcherExternalCheck(event.payload.path);
    },
  );
  cleanupCallbacks.push(unlistenFileChanged);

  const unlistenRecentFiles = await listenForRecentFilesChanges((recentFiles) => {
    if (shouldInitializeAppMenu(windowId)) {
      void refreshOpenRecentMenu(recentFiles);
      void refreshDockMenu(recentFiles);
    }
  });
  cleanupCallbacks.push(unlistenRecentFiles);

  const unlistenActivate = await listen<{ path: string }>(WINDOW_EVENT_ACTIVATE_FILE, async (event) => {
    try {
      await options.openAndActivatePath(event.payload.path);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      options.notify(`Failed to open routed file: ${message}`);
    }
  });
  cleanupCallbacks.push(unlistenActivate);

  const unlistenOpenedPaths = await listen<{ paths: string[] }>(APP_EVENT_OPENED_PATHS, async (event) => {
    await options.consumeOpenedPaths(event.payload.paths);
  });
  cleanupCallbacks.push(unlistenOpenedPaths);

  const initialOpenedPaths = await invoke<string[]>("take_pending_opened_paths");
  if (initialOpenedPaths.length > 0) {
    await options.consumeOpenedPaths(initialOpenedPaths);
  }

  const unlistenSelectTab = await listen<{ path: string }>(
    WINDOW_EVENT_SELECT_TAB_FOR_PATH,
    async (event) => {
      if (selectTabForNormalizedPath(event.payload.path)) {
        return;
      }
      // Registry desync: this window owns the claim but no longer has the tab
      // (e.g. it was closed without releasing). Open the file here instead of
      // letting the routed open vanish without any feedback.
      try {
        await options.openAndActivatePath(event.payload.path);
      } catch (error: unknown) {
        options.notify(`Failed to open routed file: ${getErrorMessage(error)}`);
      }
    },
  );
  cleanupCallbacks.push(unlistenSelectTab);

  const unlistenDestroyed = await listen(TauriEvent.WINDOW_DESTROYED, async (event) => {
    const destroyedWindowId = typeof event.payload === "string" ? event.payload : windowId;
    if (destroyedWindowId === windowId) {
      await releaseAllOpenFilesForWindow(windowId);
    }
    await logDiagnostic({
      level: "warn",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "window destroyed",
      metadata: { windowId },
    });
  });
  cleanupCallbacks.push(unlistenDestroyed);

  const unlistenWindowResized = await currentWindow.onResized(() => {
    scheduleWindowBoundsPersistence();
  });
  cleanupCallbacks.push(unlistenWindowResized);

  const unlistenWindowMoved = await currentWindow.onMoved(() => {
    scheduleWindowBoundsPersistence();
  });
  cleanupCallbacks.push(unlistenWindowMoved);

  await logPerfTiming("app shell initialized", {
    metric: "startup.total",
    durationMs: elapsedMs(startupStartedAt),
    windowId,
  });

  const cleanup = (): void => {
    runtimeReady = false;
    for (const unlisten of cleanupCallbacks) {
      unlisten();
    }
    if (windowBoundsTimer) {
      clearTimeout(windowBoundsTimer);
      windowBoundsTimer = null;
    }
    // Cancel any in-flight background startup external checks so a closing
    // window does not keep stat-ing files against a tearing-down store.
    void cancelStartupExternalChecks();
    void clearFileWatcherPaths();
    void stopOpencodeSidecar();
    if (activeRuntimeCleanup === cleanup) {
      activeRuntimeCleanup = null;
    }
  };
  activeRuntimeCleanup = cleanup;

  return {
    windowId,
    syncExternalFileWatcher,
    cleanup,
  };
}
