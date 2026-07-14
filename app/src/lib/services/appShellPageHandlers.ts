import { tick } from "svelte";
import type { AppCommandId, AppDomainState } from "../domain/contracts";
import { allTabs, getSessionSelectedTabId, isFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import type { EditorCommandRunner } from "../types/editor";
import type { EditorToolController } from "../editor/editorToolController";
import { dispatchMenuCommand, keymapCommandForEvent } from "../commands/registry";
import { getErrorMessage } from "../commands/commandErrors";
import { checkDocumentIfDeferred } from "./externalFileChanges";
import { shouldRunAutomaticCheck } from "./externalFileReloadPolicy";
import { requestConfirm } from "./confirmDialogUi";
import { confirmLargeFileOpen } from "./openFileGate";
import { describeOpenActivePathResult, openActivePath } from "./openActivePath";
import { logDiagnostic } from "./logging";
import { elapsedMs, logPerfTiming, nowMs } from "./perfDiagnostics";
import type { SettingsDialogTab } from "./settingsDialogUi";
import {
  isAlwaysRunShellCommand,
  isTargetInOrdinaryInput,
  resolveAppShellKeyRouting,
} from "./appShellKeyRouting";

export interface AppShellCommandHandlersDeps {
  notify: (message: string) => void;
  getSnapshot: () => AppDomainState;
  getCurrentWindowId: () => string;
  getEditorRunner: () => EditorCommandRunner | null;
  getEditorTools: () => EditorToolController;
  /** True when a modal/picker owns the keyboard (session list, project search, …). */
  getOverlayOpen?: () => boolean;
  openProjectSearch: (focusReplace: boolean) => void;
  openQuickOpen: () => void;
  openHeadingJump?: () => void;
  openBookmarkList?: () => void;
  openCommandPalette: () => void;
  setConsoleOpen: (open: boolean) => void;
}

export function createAppShellCommandHandlers(deps: AppShellCommandHandlersDeps) {
  function runCommand(commandId: AppCommandId): void {
    dispatchMenuCommand(commandId, {
      notify: deps.notify,
      getState: deps.getSnapshot,
      getWindowId: deps.getCurrentWindowId,
      confirm: (message) => requestConfirm({ message }),
      getEditorRunner: deps.getEditorRunner,
      getEditorTools: deps.getEditorTools,
      openProjectSearch: deps.openProjectSearch,
      openQuickOpen: deps.openQuickOpen,
      openHeadingJump: deps.openHeadingJump,
      openBookmarkList: deps.openBookmarkList,
      openCommandPalette: deps.openCommandPalette,
      setConsoleOpen: deps.setConsoleOpen,
    });
  }

  function handleKeydown(event: KeyboardEvent): void {
    const command = keymapCommandForEvent(event);
    const decision = resolveAppShellKeyRouting({
      commandId: command,
      overlayOpen: deps.getOverlayOpen?.() ?? false,
      targetInOrdinaryInput: isTargetInOrdinaryInput(event.target),
      composing: event.isComposing,
      alwaysRunWhenMapped: command ? isAlwaysRunShellCommand(command) : false,
    });
    if (decision.action !== "run-command") {
      return;
    }
    event.preventDefault();
    runCommand(decision.commandId);
  }

  return { runCommand, handleKeydown };
}

export interface AppShellFileHandlersDeps {
  getCurrentWindowId: () => string;
  getRuntimeReady: () => boolean;
  notify: (message: string) => void;
}

const TAB_ACTIVATION_CHECK_COOLDOWN_MS = 600;

export function createAppShellFileHandlers(deps: AppShellFileHandlersDeps) {
  let lastTabActivationCheck: { documentId: string; checkedAtMs: number } | null = null;

  async function openAndActivatePath(path: string): Promise<void> {
    const result = await openActivePath(path, deps.getCurrentWindowId());
    deps.notify(describeOpenActivePathResult(result));
  }

  async function openDroppedPaths(paths: string[]): Promise<void> {
    for (const droppedPath of paths) {
      try {
        await openAndActivatePath(droppedPath);
      } catch (error: unknown) {
        deps.notify(`Failed to open dropped file: ${getErrorMessage(error)}`);
      }
    }
  }

  async function consumeOpenedPaths(paths: string[]): Promise<void> {
    await openDroppedPaths(paths);
    deps.notify(`Opened ${paths.length} file(s) from app icon.`);
  }

  async function onTabActivated(tabId: string): Promise<void> {
    const sideEffectsStartedAt = nowMs();
    if (!deps.getRuntimeReady()) {
      return;
    }
    const snapshot = appState.getSnapshot();
    if (!shouldRunAutomaticCheck(snapshot.settings.externalFiles, "tab")) {
      void logPerfTiming(
        "tab activation side-effects skipped",
        {
          metric: "tab.activationSideEffects",
          durationMs: elapsedMs(sideEffectsStartedAt),
          tabId,
          skipped: true,
          reason: "checks-disabled",
        },
        "debug",
      );
      return;
    }
    const tab = allTabs(appState.getActiveSession().editorLayout).find((entry) => entry.id === tabId);
    if (!tab || !isFileTab(tab)) {
      void logPerfTiming(
        "tab activation side-effects skipped",
        {
          metric: "tab.activationSideEffects",
          durationMs: elapsedMs(sideEffectsStartedAt),
          tabId,
          skipped: true,
          reason: "non-file-tab",
        },
        "debug",
      );
      return;
    }
    const now = Date.now();
    if (
      lastTabActivationCheck &&
      lastTabActivationCheck.documentId === tab.documentId &&
      now - lastTabActivationCheck.checkedAtMs < TAB_ACTIVATION_CHECK_COOLDOWN_MS
    ) {
      void logPerfTiming(
        "tab activation side-effects skipped",
        {
          metric: "tab.activationSideEffects",
          durationMs: elapsedMs(sideEffectsStartedAt),
          tabId,
          documentId: tab.documentId,
          skipped: true,
          reason: "cooldown",
        },
        "debug",
      );
      return;
    }
    lastTabActivationCheck = {
      documentId: tab.documentId,
      checkedAtMs: now,
    };
    await checkDocumentIfDeferred(tab.documentId, "tab");
    void logPerfTiming("tab activation side-effects complete", {
      metric: "tab.activationSideEffects",
      durationMs: elapsedMs(sideEffectsStartedAt),
      tabId,
      documentId: tab.documentId,
      skipped: false,
      reason: "external-check",
    });
  }

  return {
    openAndActivatePath,
    openDroppedPaths,
    consumeOpenedPaths,
    onTabActivated,
  };
}

export interface AppShellEditorHandlersDeps {
  getDocument: (documentId: string) =>
    | {
        id: string;
        filePath?: string | null;
        contentKind?: string;
      }
    | undefined;
  getLargeFileConfirming: () => boolean;
  setLargeFileConfirming: (value: boolean) => void;
  getGoToLineValue: () => string;
  getEditorRunner: () => EditorCommandRunner | null;
  getUntitledTitleDebounceTimer: () => ReturnType<typeof setTimeout> | null;
  setUntitledTitleDebounceTimer: (timer: ReturnType<typeof setTimeout> | null) => void;
  notify: (message: string) => void;
}

export function createAppShellEditorHandlers(deps: AppShellEditorHandlersDeps) {
  async function handleConfirmLargeFile(documentId: string): Promise<void> {
    const document = deps.getDocument(documentId);
    if (
      !document?.filePath ||
      document.contentKind !== "large_pending" ||
      deps.getLargeFileConfirming()
    ) {
      return;
    }
    deps.setLargeFileConfirming(true);
    try {
      await confirmLargeFileOpen(document.id, document.filePath);
      deps.notify(`Opened ${document.filePath}`);
    } catch (error: unknown) {
      deps.notify(`Failed to open file: ${getErrorMessage(error)}`);
    } finally {
      deps.setLargeFileConfirming(false);
    }
  }

  function handleDocumentScrollTop(documentId: string, scrollTop: number): void {
    appState.setDocumentScrollTop(documentId, scrollTop);
  }

  function scheduleUntitledTitleRefresh(documentId: string): void {
    const existingTimer = deps.getUntitledTitleDebounceTimer();
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    deps.setUntitledTitleDebounceTimer(
      setTimeout(() => {
        appState.refreshUntitledTitle(documentId);
        deps.setUntitledTitleDebounceTimer(null);
      }, 300),
    );
  }

  function runGoToLine(): void {
    const line = Number(deps.getGoToLineValue());
    if (!Number.isInteger(line) || line < 1) {
      deps.notify("Go-to line must be a positive integer.");
      return;
    }
    const moved = deps.getEditorRunner()?.goToLine(line) ?? false;
    deps.notify(moved ? `Moved to line ${line}.` : "Line is out of range.");
  }

  function clearUntitledTitleDebounceTimer(): void {
    const timer = deps.getUntitledTitleDebounceTimer();
    if (timer) {
      clearTimeout(timer);
      deps.setUntitledTitleDebounceTimer(null);
    }
  }

  return {
    handleConfirmLargeFile,
    handleDocumentScrollTop,
    scheduleUntitledTitleRefresh,
    runGoToLine,
    clearUntitledTitleDebounceTimer,
  };
}

export interface AppShellMountCleanup {
  disconnectLayoutObserver: () => void;
  clearUntitledTitleDebounceTimer: () => void;
}

export interface AppShellMountDeps {
  registerSettingsDialogOpener: (
    opener: ((tab: SettingsDialogTab) => void) | null,
  ) => void;
  setupLayoutObserver: () => void;
  startAppShellRuntime: (options: {
    notify: (message: string) => void;
    runCommand: (commandId: AppCommandId) => void;
    openAndActivatePath: (path: string) => Promise<void>;
    consumeOpenedPaths: (paths: string[]) => Promise<void>;
    restoreWorkspaceSession: (workspaceRoot: string) => Promise<void>;
    loadProjectTreeRoot: () => Promise<void>;
    onFilesystemChange: (path: string) => void;
    setConsoleHeightPx: (heightPx: number) => void;
  }) => Promise<{
    cleanup: () => void;
    syncExternalFileWatcher: (state: AppDomainState) => Promise<void>;
    windowId: string;
  }>;
  notify: (message: string) => void;
  runCommand: (commandId: AppCommandId) => void;
  openAndActivatePath: (path: string) => Promise<void>;
  consumeOpenedPaths: (paths: string[]) => Promise<void>;
  restoreWorkspaceSession: (workspaceRoot: string) => Promise<void>;
  loadProjectTreeRoot: () => Promise<void>;
  notifyProjectTreeFilesystemChange: (path: string) => void;
  setConsoleHeightPx: (heightPx: number) => void;
  setRuntimeSyncExternalFileWatcher: (
    sync: ((state: AppDomainState) => Promise<void>) | null,
  ) => void;
  setCurrentWindowId: (windowId: string) => void;
  setLastSelectedTabId: (tabId: string | null) => void;
  setRuntimeReady: (ready: boolean) => void;
  routePathToLastActiveWindow: (path: string) => Promise<void>;
  getCurrentWebviewWindowLabel: () => string;
  handleKeydown: (event: KeyboardEvent) => void;
  stopChatAccessMonitor: () => void;
  flushSessionBeforeUnload: () => void;
  cleanup: AppShellMountCleanup;
}

export function setupAppShellMount(deps: AppShellMountDeps): () => void {
  let runtimeCleanup: (() => void) | undefined;
  let resizeObserverDisconnected = false;

  deps.registerSettingsDialogOpener((tab) => {
    appState.openOrFocusViewTab("settings", tab);
  });

  void tick().then(() => {
    if (!resizeObserverDisconnected) {
      deps.setupLayoutObserver();
    }
  });

  void deps
    .startAppShellRuntime({
      notify: deps.notify,
      runCommand: deps.runCommand,
      openAndActivatePath: deps.openAndActivatePath,
      consumeOpenedPaths: deps.consumeOpenedPaths,
      restoreWorkspaceSession: deps.restoreWorkspaceSession,
      loadProjectTreeRoot: deps.loadProjectTreeRoot,
      onFilesystemChange: deps.notifyProjectTreeFilesystemChange,
      setConsoleHeightPx: deps.setConsoleHeightPx,
    })
    .then((runtimeHandle) => {
      runtimeCleanup = runtimeHandle.cleanup;
      deps.setRuntimeSyncExternalFileWatcher(runtimeHandle.syncExternalFileWatcher);
      deps.setCurrentWindowId(runtimeHandle.windowId);
      deps.setLastSelectedTabId(getSessionSelectedTabId(appState.getActiveSession()));
      deps.setRuntimeReady(true);
    })
    .catch(async (error: unknown) => {
      const message = getErrorMessage(error, String(error));
      await logDiagnostic({
        level: "error",
        source: "frontend",
        timestamp: new Date().toISOString(),
        message: "startAppShellRuntime failed",
        metadata: { error: message },
      });
    });

  const search = new URLSearchParams(window.location.search);
  const openParam = search.get("open");
  if (openParam) {
    void deps
      .routePathToLastActiveWindow(openParam)
      .then(() => {
        deps.notify("File open routed to last active window.");
      })
      .catch(async () => {
        if (deps.getCurrentWebviewWindowLabel() !== "main") {
          return;
        }
        await deps.openAndActivatePath(openParam);
      })
      .catch((error: unknown) => {
        deps.notify(`Failed to open file from path: ${getErrorMessage(error)}`);
      });
  }

  function onKeydown(event: KeyboardEvent): void {
    deps.handleKeydown(event);
  }

  function preventBrowserDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  window.addEventListener("keydown", onKeydown);
  window.addEventListener("dragover", preventBrowserDragOver);

  function onPageHide(): void {
    deps.flushSessionBeforeUnload();
  }

  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("beforeunload", onPageHide);

  return () => {
    deps.registerSettingsDialogOpener(null);
    resizeObserverDisconnected = true;
    deps.cleanup.disconnectLayoutObserver();
    deps.cleanup.clearUntitledTitleDebounceTimer();
    deps.setRuntimeReady(false);
    deps.setRuntimeSyncExternalFileWatcher(null);
    runtimeCleanup?.();
    deps.stopChatAccessMonitor();
    window.removeEventListener("keydown", onKeydown);
    window.removeEventListener("dragover", preventBrowserDragOver);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("beforeunload", onPageHide);
    deps.flushSessionBeforeUnload();
  };
}
