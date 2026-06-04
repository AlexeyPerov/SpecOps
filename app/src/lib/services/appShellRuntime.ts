import { emit, listen, TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { AppCommandId, AppDomainState } from "../domain/contracts";
import { appState, setThemeSaveErrorNotifier } from "../state/appState";
import { chatStore } from "../state/chatStore";
import { initializeLogging, logDiagnostic } from "./logging";
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
  WINDOW_EVENT_TRANSFER_TAB,
  WINDOW_EVENT_WINDOW_READY,
  type MergeTabPayload,
  markWindowActive,
} from "./windowManager";
import { restoreWindowSession } from "./sessionManager";
import { applyWindowBounds, readWindowBounds } from "./windowBounds";
import { syncOpenFileRegistryForWindow, claimOpenFile, releaseAllOpenFilesForWindow } from "./openFileRegistry";
import {
  loadPersistedSettings,
  toExternalFilesSettings,
} from "./settingsStore";
import { loadProviderApiKey } from "./providerSecretsStore";
import {
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
} from "./fileWatcher";
import { selectTabForNormalizedPath } from "./openFileGate";
import { initializeChatProviders } from "../ai/providers/bootstrap";
import { normalizePathSync } from "./diskFingerprint";
import { ensureWorkspaceReadAccess } from "./fileSystem";
import { readConsoleHeightPreference } from "./consoleTabPrefs";
import { watchedPathsFromState } from "./appShellHelpers";

const APP_EVENT_OPENED_PATHS = "spec-ops/app/opened-paths";
const DOCK_NEW_WINDOW_EVENT = "spec-ops/dock/new-window";
const DOCK_OPEN_RECENT_EVENT = "spec-ops/dock/open-recent";
const DOCK_CLEAR_RECENT_EVENT = "spec-ops/dock/clear-recent";

export interface AppShellRuntimeOptions {
  notify: (message: string) => void;
  runCommand: (commandId: AppCommandId) => void;
  openAndActivatePath: (path: string) => Promise<void>;
  consumeOpenedPaths: (paths: string[]) => Promise<void>;
  restoreWorkspaceAgentSession: (normalizedRoot: string) => Promise<void>;
  loadProjectTreeRoot: () => Promise<void>;
  onFilesystemChange?: (path: string) => void;
  syncProjectTreeWatcher?: (root: string | null) => Promise<void>;
  setConsoleHeightPx: (heightPx: number) => void;
}

export interface AppShellRuntimeHandle {
  windowId: string;
  cleanup: () => void;
  syncExternalFileWatcher: (state: AppDomainState) => Promise<void>;
}

export async function startAppShellRuntime(
  options: AppShellRuntimeOptions,
): Promise<AppShellRuntimeHandle> {
  const currentWindow = getCurrentWebviewWindow();
  const windowId = currentWindow.label;
  let runtimeReady = false;
  let lastWatcherSyncKey = "";
  let windowBoundsTimer: ReturnType<typeof setTimeout> | null = null;
  let applyingWindowBounds = false;
  const cleanupCallbacks: UnlistenFn[] = [];

  async function syncExternalFileWatcher(state: AppDomainState): Promise<void> {
    if (!runtimeReady) {
      return;
    }
    const paths = watchedPathsFromState(state);
    const syncKey = `${state.settings.externalFiles.watchExternalChanges}:${paths.join("\0")}`;
    if (syncKey === lastWatcherSyncKey) {
      return;
    }
    lastWatcherSyncKey = syncKey;

    if (!shouldSyncFileWatcher(state.settings.externalFiles)) {
      await clearFileWatcherPaths();
      return;
    }
    await syncFileWatcherPaths(paths);
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
      try {
        await options.openAndActivatePath(droppedPath);
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        options.notify(`Failed to open dropped file: ${message}`);
      }
    }
  }

  const unlistenTransfer = await listen<{ filePath: string | null; content: string; title: string }>(
    WINDOW_EVENT_TRANSFER_TAB,
    async (event) => {
      const documentId = appState.openTransferredTab(event.payload);
      if (event.payload.filePath && documentId) {
        await claimOpenFile(event.payload.filePath, windowId, documentId);
        await initializeDocumentDiskState(documentId, event.payload.filePath);
      }
    },
  );
  cleanupCallbacks.push(unlistenTransfer);

  const unlistenMergeTab = await listen<MergeTabPayload>(WINDOW_EVENT_MERGE_TAB, async (event) => {
    const { sourceWindowId: _sourceWindowId, sourceTabId: _sourceTabId, ...payload } =
      event.payload;
    const documentId = appState.openTransferredTab(payload);
    if (payload.filePath && documentId) {
      await claimOpenFile(payload.filePath, windowId, documentId);
      await initializeDocumentDiskState(documentId, payload.filePath);
    }
  });
  cleanupCallbacks.push(unlistenMergeTab);

  const unlistenDockNewWindow = await listen(DOCK_NEW_WINDOW_EVENT, () => {
    options.runCommand("app.newWindow");
  });
  cleanupCallbacks.push(unlistenDockNewWindow);

  const unlistenDockOpenRecent = await listen<{ path: string }>(DOCK_OPEN_RECENT_EVENT, (event) => {
    queueOpenRecentPath(event.payload.path);
  });
  cleanupCallbacks.push(unlistenDockOpenRecent);

  const unlistenDockClearRecent = await listen(DOCK_CLEAR_RECENT_EVENT, () => {
    options.runCommand("file.clearRecentFiles");
  });
  cleanupCallbacks.push(unlistenDockClearRecent);

  await emit(WINDOW_EVENT_WINDOW_READY, { windowId });

  const persistedSettings = await loadPersistedSettings();
  const httpApiKey = await loadProviderApiKey("http");
  setThemeSaveErrorNotifier(options.notify);
  await appState.loadTheme();
  if (persistedSettings) {
    appState.applyPersistedSettings({
      wrapLines: persistedSettings.wrapLines,
      zoomPercent: persistedSettings.zoomPercent,
      externalFiles: toExternalFilesSettings(persistedSettings),
      decoratePlaintextSymbols: persistedSettings.decoratePlaintextSymbols,
      hideActivityRailWhenNotepadOnly: persistedSettings.hideActivityRailWhenNotepadOnly,
      providerSettings: persistedSettings.providerSettings,
      providerModelCatalogs: persistedSettings.providerModelCatalogs,
      commandBindingOverrides: persistedSettings.commandBindingOverrides,
    });
  }
  appState.setProviderApiKey("http", httpApiKey);

  initializeChatProviders();
  options.setConsoleHeightPx(await readConsoleHeightPreference());
  await initializeLogging();

  const unlistenDragDrop = await currentWindow.onDragDropEvent(async (event) => {
    if (event.payload.type !== "drop") {
      return;
    }
    await openDroppedPaths(event.payload.paths);
  });
  cleanupCallbacks.push(unlistenDragDrop);

  await markWindowActive(windowId);

  const restoredSession = await restoreWindowSession(windowId);
  if (restoredSession) {
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
  }

  const restoredWorkspaceRoot = appState.getWorkspaceRoot();
  if (restoredWorkspaceRoot) {
    const normalizedRoot = normalizePathSync(restoredWorkspaceRoot);
    void ensureWorkspaceReadAccess(normalizedRoot);
    chatStore.setActiveWorkspaceRoot(normalizedRoot);
    await options.restoreWorkspaceAgentSession(normalizedRoot);
  } else {
    chatStore.setActiveWorkspaceRoot(null);
  }

  if (shouldInitializeAppMenu(windowId)) {
    const recentFiles = appState.getSnapshot().recentFiles;
    await initializeAppMenu(options.runCommand, recentFiles);
    await refreshDockMenu(recentFiles);
  }

  await options.loadProjectTreeRoot();
  await runStartupExternalChecks();

  runtimeReady = true;
  await syncExternalFileWatcher(appState.getSnapshot());

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

  const unlistenFileChanged = await listen<{ path: string }>(FILE_CHANGED_EVENT, async (event) => {
    if (!runtimeReady) {
      return;
    }
    options.onFilesystemChange?.(event.payload.path);
    await runWatcherExternalCheck(event.payload.path);
  });
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
      selectTabForNormalizedPath(event.payload.path);
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

  await logDiagnostic({
    level: "info",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "app shell initialized",
    metadata: { windowId },
  });

  return {
    windowId,
    syncExternalFileWatcher,
    cleanup: () => {
      runtimeReady = false;
      for (const unlisten of cleanupCallbacks) {
        unlisten();
      }
      if (windowBoundsTimer) {
        clearTimeout(windowBoundsTimer);
        windowBoundsTimer = null;
      }
      void clearFileWatcherPaths();
    },
  };
}
