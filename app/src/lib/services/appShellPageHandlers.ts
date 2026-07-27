import { tick } from "svelte";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppCommandId, AppDomainState } from "../domain/contracts";
import { allTabs, getSessionSelectedTabId, isFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import type { EditorCommandRunner } from "../types/editor";
import type { EditorToolController } from "../editor/editorToolController";
import { dispatchMenuCommand, isCommandAvailableInState, keymapCommandForEvent } from "../commands/registry";
import { getErrorMessage } from "../commands/commandErrors";
import { checkDocumentIfDeferred } from "./externalFileChanges";
import { shouldRunAutomaticCheck } from "./externalFileReloadPolicy";
import { requestConfirm } from "./confirmDialogUi";
import { confirmLargeFileOpen } from "./openFileGate";
import {
  describeOpenActivePathResult,
  isSuccessfulOpenActivePathResult,
  openActivePath,
} from "./openActivePath";
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
  /**
   * True when a *modal* overlay owns the keyboard (session list, pickers, …).
   * H30: must exclude non-modal surfaces (Find-in-Project panel, context
   * menus) or global shortcuts die app-wide while they are visible.
   */
  getOverlayOpen?: () => boolean;
  openProjectSearch: (focusReplace: boolean) => void;
  openQuickOpen: () => void;
  openHeadingJump?: () => void;
  openBookmarkList?: () => void;
  openSnippetInsert?: () => void;
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
      openSnippetInsert: deps.openSnippetInsert,
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
      commandAvailable: command
        ? isCommandAvailableInState(command, deps.getSnapshot())
        : true,
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

  /**
   * Batch-open paths from the app icon / OS open-files event.
   * Notifies with the successful open count only; failures and cross-window
   * redirects are reported per path via {@link describeOpenActivePathResult}.
   */
  async function consumeOpenedPaths(paths: string[]): Promise<void> {
    let successCount = 0;
    for (const path of paths) {
      try {
        const result = await openActivePath(path, deps.getCurrentWindowId());
        if (isSuccessfulOpenActivePathResult(result)) {
          successCount += 1;
          continue;
        }
        deps.notify(describeOpenActivePathResult(result));
      } catch (error: unknown) {
        deps.notify(`Failed to open file: ${getErrorMessage(error)}`);
      }
    }
    deps.notify(`Opened ${successCount} file(s) from app icon.`);
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
  flushSessionBeforeUnload: () => void | Promise<void>;
  /**
   * Runs on an intercepted window close. Resolves true when the close may proceed
   * (unsaved work handled and the session snapshot flushed), false to keep the window
   * open. See `windowCloseFlow.confirmWindowClose`.
   */
  confirmWindowClose: () => Promise<boolean>;
  /**
   * Removes this window's `windows[...]` entry from session.json once a close is
   * confirmed. Only invoked for secondary windows: their labels are unique per
   * creation, so the entry could never be restored and would otherwise persist
   * (with full document text) forever. See `sessionManager.removeWindowSessionEntry`.
   */
  removeWindowSessionEntry?: (windowId: string) => Promise<void>;
  cleanup: AppShellMountCleanup;
}

export function setupAppShellMount(deps: AppShellMountDeps): () => void {
  let runtimeCleanup: (() => void) | undefined;
  let resizeObserverDisconnected = false;
  let disposed = false;

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
      if (disposed) {
        runtimeHandle.cleanup();
        return;
      }
      runtimeCleanup = runtimeHandle.cleanup;
      deps.setRuntimeSyncExternalFileWatcher(runtimeHandle.syncExternalFileWatcher);
      deps.setCurrentWindowId(runtimeHandle.windowId);
      deps.setLastSelectedTabId(getSessionSelectedTabId(appState.getActiveSession()));
      deps.setRuntimeReady(true);
    })
    .catch(async (error: unknown) => {
      const message = getErrorMessage(error, String(error));
      // `runtimeReady` stays false, which leaves every gated $effect off — session
      // persistence, settings persistence, the project tree and the external file
      // watcher all included. The shell still renders and accepts edits, so failing
      // silently here means the user types into buffers that are never saved. Tell
      // them, and keep it phrased as "don't rely on this window".
      if (!disposed) {
        deps.notify(
          `SpecOps could not finish starting up: ${message}. Saving and session restore are disabled — reopen the window to retry.`,
        );
      }
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
    // Fire-and-forget: pagehide/beforeunload cannot reliably await async work.
    // This is now only a backstop — the awaited flush lives in the
    // `onCloseRequested` handler below, which runs before the webview tears down.
    void deps.flushSessionBeforeUnload();
  }

  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("beforeunload", onPageHide);

  // Intercept window/app close so unsaved buffers get a prompt and the session
  // snapshot is actually written. Tauri lets us cancel the close and re-issue it once
  // the async work is done, which `pagehide` cannot do.
  let closeConfirmed = false;
  let closeInFlight = false;
  let unlistenCloseRequested: (() => void) | null = null;

  async function handleCloseRequested(event: { preventDefault: () => void }): Promise<void> {
    if (closeConfirmed) {
      return;
    }
    event.preventDefault();
    if (closeInFlight) {
      // The user hit close again while the prompt was up; ignore the repeat rather
      // than stacking a second dialog over the first.
      return;
    }
    closeInFlight = true;
    try {
      const mayClose = await deps.confirmWindowClose();
      if (mayClose) {
        closeConfirmed = true;
        // Secondary windows: drop the session entry the confirm flow just
        // flushed. It can never be restored (labels are unique per creation)
        // and would otherwise keep a full copy of the closed tabs' text in
        // session.json forever. `removeWindowSessionEntry` is a no-op for main.
        const label = deps.getCurrentWebviewWindowLabel();
        if (label !== "main" && deps.removeWindowSessionEntry) {
          try {
            await deps.removeWindowSessionEntry(label);
          } catch {
            // Best-effort: a failed prune must not block the close. The
            // startup prune in appShellRuntime catches leftovers next launch.
          }
        }
        await getCurrentWindow().close();
      }
    } catch (error: unknown) {
      await logDiagnostic({
        level: "error",
        source: "frontend",
        timestamp: new Date().toISOString(),
        message: "window close confirmation failed",
        metadata: { error: getErrorMessage(error, String(error)) },
      });
      // Never trap the user in a window they asked to close because our own prompt
      // broke. Fall back to closing, having at least tried to flush.
      closeConfirmed = true;
      await getCurrentWindow().close();
    } finally {
      closeInFlight = false;
    }
  }

  // `getCurrentWindow()` reads Tauri internals off the global scope and throws when
  // they are absent, so this is guarded rather than chained: an unavailable window API
  // must not abort the rest of the mount. Losing the interceptor only costs us the
  // prompt — the pagehide backstop above still runs.
  try {
    void getCurrentWindow()
      .onCloseRequested(handleCloseRequested)
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenCloseRequested = unlisten;
      })
      .catch(() => {});
  } catch {
    // No window API in this environment.
  }

  return () => {
    disposed = true;
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
    unlistenCloseRequested?.();
    unlistenCloseRequested = null;
    void deps.flushSessionBeforeUnload();
  };
}
