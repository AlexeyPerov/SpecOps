<script lang="ts">
  import { onMount, tick } from "svelte";
  import EditorSurface from "../lib/components/EditorSurface.svelte";
  import ConsolePanel from "../lib/components/ConsolePanel.svelte";
  import FindReplacePanel from "../lib/components/FindReplacePanel.svelte";
  import TabBar from "../lib/components/TabBar.svelte";
  import ActivityRail from "../lib/components/ActivityRail.svelte";
  import ProjectPanel from "../lib/components/ProjectPanel.svelte";
  import {
    dispatchMenuCommand,
    initializeAppMenu,
    keymapCommandForEvent,
    refreshOpenRecentMenu,
    shouldInitializeAppMenu,
  } from "../lib/commands/registry";
  import type { AppCommandId } from "../lib/domain/contracts";
  import type { EditorCommandRunner } from "../lib/types/editor";
  import { appState } from "../lib/state/appState";
  import { initializeLogging, logDiagnostic } from "../lib/services/logging";
  import { describeOpenActivePathResult, openActivePath } from "../lib/services/openActivePath";
  import { listenForRecentFilesChanges } from "../lib/services/recentFilesSync";
  import { listen, TauriEvent } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import {
    WINDOW_EVENT_ACTIVATE_FILE,
    WINDOW_EVENT_SELECT_TAB_FOR_PATH,
    WINDOW_EVENT_TRANSFER_TAB,
    markWindowActive,
    routePathToLastActiveWindow,
  } from "../lib/services/windowManager";
  import {
    restoreWindowSession,
    scheduleSessionPersistence,
    persistSessionSnapshot,
  } from "../lib/services/sessionManager";
  import { applyWindowBounds, readWindowBounds } from "../lib/services/windowBounds";
  import {
    selectTabForNormalizedPath,
  } from "../lib/services/openFileGate";
  import {
    claimOpenFile,
    releaseAllOpenFilesForWindow,
    syncOpenFileRegistryForWindow,
  } from "../lib/services/openFileRegistry";
  import {
    loadPersistedSettings,
    savePersistedSettings,
    toExternalFilesSettings,
    toPersistedSettings,
  } from "../lib/services/settingsStore";
  import {
    checkDocumentIfDeferred,
    initializeDocumentDiskState,
    runFocusExternalChecks,
    runStartupExternalChecks,
    runWatcherExternalCheck,
    shouldSyncFileWatcher,
  } from "../lib/services/externalFileChanges";
  import {
    clearFileWatcherPaths,
    FILE_CHANGED_EVENT,
    syncFileWatcherPaths,
  } from "../lib/services/fileWatcher";
  import { marked } from "marked";
  import { diffLines } from "diff";
  import type { AppDomainState, ExternalFilesSettings } from "../lib/domain/contracts";
  import type { ContextId, DocumentState } from "../lib/domain/contracts";
  import { APP_THEME_IDS, getThemeLabel, getThemeAccentHex } from "../lib/styles/themes";
  import type { AppTheme } from "../lib/styles/themes";
  import { loadDirectoryChildren, type ProjectTreeNode } from "../lib/services/projectTree";
  import { normalizePathSync } from "../lib/services/diskFingerprint";

  const APP_EVENT_OPENED_PATHS = "spec-ops/app/opened-paths";

  let settingsPaneOpen = false;
  let consoleOpen = false;
  let statusMessage = "Ready";
  let editorRunner: EditorCommandRunner | null = null;
  let currentWindowId = "main";
  let findQuery = "";
  let replaceValue = "";
  let findCaseSensitive = false;
  let goToLineValue = "";
  let markdownViewMode: "edit" | "split" | "preview" = "edit";
  let preferredMarkdownViewMode: "edit" | "split" | "preview" = "edit";
  let previousActiveContextId: ContextId | null = null;
  let shellMainRowEl: HTMLDivElement | null = null;
  let editorShellEl: HTMLElement | null = null;
  let editorPaneEl: HTMLElement | null = null;
  let shellMainRowWidth = 0;
  let editorPaneWidth = 0;
  let layoutResizeObserver: ResizeObserver | null = null;
  let markdownEditorPaneEl: HTMLDivElement | null = null;
  let markdownPreviewPaneEl: HTMLDivElement | null = null;
  let splitScrollCleanup: (() => void) | null = null;
  let lastMarkdownDocumentId: string | null = null;
  let untitledTitleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSelectedTabId: string | null = null;
  let lastWatcherSyncKey = "";
  let runtimeReady = false;
  let windowBoundsTimer: ReturnType<typeof setTimeout> | null = null;
  let applyingWindowBounds = false;
  let workspaceContextMenu:
    | { workspaceId: ContextId; x: number; y: number }
    | null = null;
  let workspaceContextMenuEl: HTMLDivElement | null = null;
  let projectTreeRootNodes: ProjectTreeNode[] = [];
  let projectTreeChildrenByPath = new Map<string, ProjectTreeNode[]>();
  let projectTreeExpandedPaths = new Set<string>();
  let projectTreeLoadingPaths = new Set<string>();
  let projectTreeShowHidden = false;
  let autoProjectPanelCollapsed = false;
  const MARKDOWN_SPLIT_MIN_EDITOR_WIDTH = 760;

  $: state = $appState;
  $: activeContextId = state.contexts.activeContextId;
  $: workspaces = state.contexts.workspaces;
  $: activeWorkspaceRoot = appState.getWorkspaceRoot(activeContextId);
  $: showProjectPanel =
    Boolean(activeWorkspaceRoot) &&
    !state.editor.projectPanelCollapsed &&
    !autoProjectPanelCollapsed;
  $: showActivityRail = !(
    state.settings.hideActivityRailWhenNotepadOnly &&
    state.contexts.workspaces.length === 0
  );
  $: activeTab = state.session.openTabs.find(
    (tab) => tab.id === state.session.selectedTabId,
  );
  $: activeDocument =
    state.documents.find((documentState) => documentState.id === activeTab?.documentId) ??
    state.documents[0];
  $: isMarkdownDocument = activeDocument?.language === "markdown";
  $: markdownHtml =
    isMarkdownDocument && activeDocument
      ? (marked.parse(activeDocument.content) as string)
      : "";
  $: diffRows =
    state.editor.previewMode === "diff" && activeDocument
      ? diffLines(activeDocument.savedContent, activeDocument.content)
      : [];
  $: statusPath = formatStatusPath(activeDocument?.filePath ?? null, activeDocument?.title);
  $: activeDocumentPath = activeDocument?.filePath ? normalizePathSync(activeDocument.filePath) : null;

  async function loadProjectTreeRoot(): Promise<void> {
    if (!activeWorkspaceRoot) {
      projectTreeRootNodes = [];
      projectTreeChildrenByPath = new Map();
      projectTreeExpandedPaths = new Set();
      projectTreeLoadingPaths = new Set();
      return;
    }
    projectTreeRootNodes = await loadDirectoryChildren(activeWorkspaceRoot, activeWorkspaceRoot, {
      showHidden: projectTreeShowHidden,
    });
  }

  async function loadProjectTreeChildren(directoryPath: string): Promise<void> {
    if (!activeWorkspaceRoot) {
      return;
    }
    projectTreeLoadingPaths = new Set([...projectTreeLoadingPaths, directoryPath]);
    try {
      const children = await loadDirectoryChildren(activeWorkspaceRoot, directoryPath, {
        showHidden: projectTreeShowHidden,
      });
      const next = new Map(projectTreeChildrenByPath);
      next.set(directoryPath, children);
      projectTreeChildrenByPath = next;
    } finally {
      const nextLoading = new Set(projectTreeLoadingPaths);
      nextLoading.delete(directoryPath);
      projectTreeLoadingPaths = nextLoading;
    }
  }

  async function handleToggleProjectTreeDirectory(path: string): Promise<void> {
    if (projectTreeExpandedPaths.has(path)) {
      const next = new Set(projectTreeExpandedPaths);
      next.delete(path);
      projectTreeExpandedPaths = next;
      return;
    }
    projectTreeExpandedPaths = new Set([...projectTreeExpandedPaths, path]);
    if (!projectTreeChildrenByPath.has(path)) {
      await loadProjectTreeChildren(path);
    }
  }

  async function handleOpenProjectTreeFile(path: string): Promise<void> {
    const result = await openActivePath(path, currentWindowId);
    notify(describeOpenActivePathResult(result));
  }

  async function refreshProjectTree(): Promise<void> {
    if (!activeWorkspaceRoot) {
      return;
    }
    const expanded = [...projectTreeExpandedPaths];
    projectTreeChildrenByPath = new Map();
    await loadProjectTreeRoot();
    for (const path of expanded) {
      await loadProjectTreeChildren(path);
    }
  }

  function toggleProjectPanelCollapsed(next: boolean): void {
    appState.setProjectPanelCollapsed(next);
  }

  async function toggleProjectTreeHidden(next: boolean): Promise<void> {
    projectTreeShowHidden = next;
    await refreshProjectTree();
  }

  function expandAncestorsForActiveFile(path: string): void {
    if (!activeWorkspaceRoot) {
      return;
    }
    const normalizedRoot = normalizePathSync(activeWorkspaceRoot).replace(/\/+$/, "");
    const normalizedPath = normalizePathSync(path).replace(/\/+$/, "");
    if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
      return;
    }
    const relative = normalizedPath.slice(normalizedRoot.length + 1);
    const parts = relative.split("/").filter(Boolean);
    if (parts.length <= 1) {
      return;
    }
    const nextExpanded = new Set(projectTreeExpandedPaths);
    let cursor = normalizedRoot;
    for (const part of parts.slice(0, -1)) {
      cursor = `${cursor}/${part}`;
      nextExpanded.add(cursor);
    }
    projectTreeExpandedPaths = nextExpanded;
  }

  function handleDocumentScrollTop(documentId: string, scrollTop: number): void {
    appState.setDocumentScrollTop(documentId, scrollTop);
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

  async function persistWindowBoundsNow(): Promise<void> {
    if (windowBoundsTimer) {
      clearTimeout(windowBoundsTimer);
      windowBoundsTimer = null;
    }
    const bounds = await readWindowBounds(getCurrentWebviewWindow());
    appState.setWindowBounds(bounds);
    await persistSessionSnapshot(appState.getSnapshot(), currentWindowId);
  }

  function formatStatusPath(filePath: string | null, fallbackTitle: string | undefined): string {
    if (!filePath) {
      return fallbackTitle ?? "Untitled";
    }
    const normalized = filePath.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
    return parts[parts.length - 1] ?? normalized;
  }

  function notify(message: string): void {
    statusMessage = message;
  }

  function toggleConsole(): void {
    consoleOpen = !consoleOpen;
  }

  function canFitMarkdownSplit(): boolean {
    return editorPaneWidth >= MARKDOWN_SPLIT_MIN_EDITOR_WIDTH;
  }

  function setMarkdownViewMode(nextMode: "edit" | "split" | "preview"): void {
    preferredMarkdownViewMode = nextMode;
    if (nextMode === "split" && !canFitMarkdownSplit()) {
      markdownViewMode = "edit";
      return;
    }
    markdownViewMode = nextMode;
  }

  function updateLayoutMeasurements(): void {
    shellMainRowWidth = shellMainRowEl?.clientWidth ?? 0;
    editorPaneWidth = editorPaneEl?.clientWidth ?? 0;
  }

  function applyResponsiveLayoutRules(): void {
    const workspaceActive = Boolean(activeWorkspaceRoot);
    const shouldAutoCollapsePanel = shellMainRowWidth > 0 && shellMainRowWidth < 1100 && workspaceActive;
    if (autoProjectPanelCollapsed !== shouldAutoCollapsePanel) {
      autoProjectPanelCollapsed = shouldAutoCollapsePanel;
    }

    const projectPanelCollapsed = state.editor.projectPanelCollapsed || autoProjectPanelCollapsed;
    if (shellMainRowWidth > 0 && shellMainRowWidth < 900 && projectPanelCollapsed) {
      consoleOpen = false;
    }
  }

  function handleActiveContextSwitch(nextContextId: ContextId): void {
    if (previousActiveContextId === null) {
      previousActiveContextId = nextContextId;
      return;
    }
    if (previousActiveContextId === nextContextId) {
      return;
    }
    previousActiveContextId = nextContextId;
    consoleOpen = false;
    setMarkdownViewMode("edit");
    closeWorkspaceContextMenu();
    void loadProjectTreeRoot();
  }

  function handleSelectContext(contextId: ContextId): void {
    const switched = appState.switchContext(contextId);
    if (!switched) {
      return;
    }
    closeWorkspaceContextMenu();
  }

  function handleAddWorkspace(): void {
    runCommand("workspace.add");
    void loadProjectTreeRoot();
  }

  function handleOpenWorkspaceContextMenu(
    workspaceId: ContextId,
    x: number,
    y: number,
  ): void {
    workspaceContextMenu = { workspaceId, x, y };
    window.addEventListener("pointerdown", onWindowPointerDownWorkspaceMenu);
    window.addEventListener("keydown", onWindowKeydownWorkspaceMenu);
  }

  function closeWorkspaceContextMenu(): void {
    if (!workspaceContextMenu) {
      return;
    }
    workspaceContextMenu = null;
    window.removeEventListener("pointerdown", onWindowPointerDownWorkspaceMenu);
    window.removeEventListener("keydown", onWindowKeydownWorkspaceMenu);
  }

  function onWindowPointerDownWorkspaceMenu(event: PointerEvent): void {
    if (!workspaceContextMenu) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && workspaceContextMenuEl?.contains(target)) {
      return;
    }
    closeWorkspaceContextMenu();
  }

  function onWindowKeydownWorkspaceMenu(event: KeyboardEvent): void {
    if (workspaceContextMenu && event.key === "Escape") {
      closeWorkspaceContextMenu();
    }
  }

  function resolveCloseWorkspaceAction(dirtyDocuments: DocumentState[]): "save-all" | "discard-all" | "cancel" {
    const count = dirtyDocuments.length;
    const saveAll = window.confirm(
      `This workspace has ${count} unsaved file(s). Press OK to Save All, or Cancel for more options.`,
    );
    if (saveAll) {
      return "save-all";
    }
    const discard = window.confirm("Discard all unsaved changes and close this workspace?");
    return discard ? "discard-all" : "cancel";
  }

  function closeWorkspaceFromContextMenu(workspaceId: ContextId): void {
    const closed = appState.closeWorkspace(workspaceId, {
      resolveAction: resolveCloseWorkspaceAction,
      saveAllDirtyDocuments: (dirtyDocuments) => {
        for (const doc of dirtyDocuments) {
          if (!doc.filePath) {
            continue;
          }
          appState.markDocumentSaved(doc.id, doc.filePath, doc.content);
        }
      },
    });
    if (closed) {
      notify("Workspace closed.");
      consoleOpen = false;
      setMarkdownViewMode("edit");
      void loadProjectTreeRoot();
    }
    closeWorkspaceContextMenu();
  }

  function scheduleUntitledTitleRefresh(documentId: string): void {
    if (untitledTitleDebounceTimer) {
      clearTimeout(untitledTitleDebounceTimer);
    }
    untitledTitleDebounceTimer = setTimeout(() => {
      appState.refreshUntitledTitle(documentId);
      untitledTitleDebounceTimer = null;
    }, 300);
  }

  function teardownSplitScrollSync(): void {
    splitScrollCleanup?.();
    splitScrollCleanup = null;
  }

  function syncByRatio(source: HTMLElement, target: HTMLElement): void {
    const sourceScrollable = source.scrollHeight - source.clientHeight;
    const targetScrollable = target.scrollHeight - target.clientHeight;
    if (sourceScrollable <= 0 || targetScrollable <= 0) {
      target.scrollTop = 0;
      return;
    }
    const ratio = source.scrollTop / sourceScrollable;
    target.scrollTop = ratio * targetScrollable;
  }

  async function setupSplitScrollSync(): Promise<void> {
    teardownSplitScrollSync();
    await tick();

    const editorScroller = markdownEditorPaneEl?.querySelector(".cm-scroller") as HTMLElement | null;
    const previewScroller = markdownPreviewPaneEl;
    if (!editorScroller || !previewScroller) {
      return;
    }

    let syncingFromEditor = false;
    let syncingFromPreview = false;

    const onEditorScroll = (): void => {
      if (syncingFromPreview) {
        return;
      }
      syncingFromEditor = true;
      syncByRatio(editorScroller, previewScroller);
      requestAnimationFrame(() => {
        syncingFromEditor = false;
      });
    };

    const onPreviewScroll = (): void => {
      if (syncingFromEditor) {
        return;
      }
      syncingFromPreview = true;
      syncByRatio(previewScroller, editorScroller);
      requestAnimationFrame(() => {
        syncingFromPreview = false;
      });
    };

    editorScroller.addEventListener("scroll", onEditorScroll, { passive: true });
    previewScroller.addEventListener("scroll", onPreviewScroll, { passive: true });
    onEditorScroll();

    splitScrollCleanup = () => {
      editorScroller.removeEventListener("scroll", onEditorScroll);
      previewScroller.removeEventListener("scroll", onPreviewScroll);
    };
  }

  function runCommand(commandId: AppCommandId): void {
    dispatchMenuCommand(commandId, {
      isSettingsPaneOpen: () => settingsPaneOpen,
      setSettingsPaneOpen: (next) => {
        settingsPaneOpen = next;
      },
      notify,
      getState: () => state,
      getWindowId: () => currentWindowId,
      confirm: (message) => window.confirm(message),
      getEditorRunner: () => editorRunner,
    });
  }

  async function openDroppedPaths(paths: string[]): Promise<void> {
    for (const droppedPath of paths) {
      try {
        await openAndActivatePath(droppedPath);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown error";
        notify(`Failed to open dropped file: ${message}`);
      }
    }
  }

  async function consumeOpenedPaths(paths: string[]): Promise<void> {
    await openDroppedPaths(paths);
    notify(`Opened ${paths.length} file(s) from app icon.`);
  }

  async function openAndActivatePath(path: string): Promise<void> {
    const result = await openActivePath(path, currentWindowId);
    notify(describeOpenActivePathResult(result));
  }

  function watchedPathsFromState(appDomainState: AppDomainState): string[] {
    const paths = new Set<string>();
    for (const tab of appDomainState.session.openTabs) {
      const documentState = appDomainState.documents.find((doc) => doc.id === tab.documentId);
      if (documentState?.filePath) {
        paths.add(documentState.filePath);
      }
    }
    return [...paths];
  }

  async function syncExternalFileWatcher(appDomainState: AppDomainState): Promise<void> {
    const paths = watchedPathsFromState(appDomainState);
    const syncKey = `${appDomainState.settings.externalFiles.watchExternalChanges}:${paths.join("\0")}`;
    if (syncKey === lastWatcherSyncKey) {
      return;
    }
    lastWatcherSyncKey = syncKey;

    if (!shouldSyncFileWatcher(appDomainState.settings.externalFiles)) {
      await clearFileWatcherPaths();
      return;
    }
    await syncFileWatcherPaths(paths);
  }

  async function onTabActivated(tabId: string): Promise<void> {
    if (!runtimeReady) {
      return;
    }
    const snapshot = appState.getSnapshot();
    const tab = snapshot.session.openTabs.find((entry) => entry.id === tabId);
    if (!tab) {
      return;
    }
    await checkDocumentIfDeferred(tab.documentId, "tab");
  }

  $: if (runtimeReady && currentWindowId) {
    void syncExternalFileWatcher(state);
  }

  $: if (runtimeReady && state.session.selectedTabId !== lastSelectedTabId) {
    const nextTabId = state.session.selectedTabId;
    if (nextTabId && nextTabId !== lastSelectedTabId) {
      lastSelectedTabId = nextTabId;
      void onTabActivated(nextTabId);
    }
  }

  function updateExternalFilesSetting(
    key: keyof ExternalFilesSettings,
    value: boolean,
  ): void {
    const current = appState.getSnapshot().settings.externalFiles;
    appState.setExternalFilesSettings({
      ...current,
      [key]: value,
    });
  }

  async function setupRuntime(): Promise<() => void> {
    const currentWindow = getCurrentWebviewWindow();
    currentWindowId = currentWindow.label;
    appState.initializeTheme();
    await initializeLogging();

    const unlistenDragDrop = await currentWindow.onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop") {
        return;
      }
      await openDroppedPaths(event.payload.paths);
    });

    await markWindowActive(currentWindowId);

    const restoredSession = await restoreWindowSession(currentWindowId);
    if (restoredSession) {
      appState.applyWindowSession(restoredSession.snapshot, restoredSession.recentFiles);
      appState.normalizeUntitledTitles();
      await syncOpenFileRegistryForWindow(currentWindowId, appState.getSnapshot());
      const restoredBounds = appState.getSnapshot().session.windowBounds;
      if (restoredBounds) {
        applyingWindowBounds = true;
        try {
          await applyWindowBounds(currentWindow, restoredBounds);
        } finally {
          applyingWindowBounds = false;
        }
      }
      statusMessage = "Session restored.";
    }
    if (shouldInitializeAppMenu(currentWindowId)) {
      await initializeAppMenu(runCommand, appState.getSnapshot().recentFiles);
    }

    const persistedSettings = await loadPersistedSettings();
    if (persistedSettings) {
      appState.applyPersistedSettings({
        theme: persistedSettings.theme,
        wrapLines: persistedSettings.wrapLines,
        zoomPercent: persistedSettings.zoomPercent,
        externalFiles: toExternalFilesSettings(persistedSettings),
        decoratePlaintextSymbols: persistedSettings.decoratePlaintextSymbols,
        hideActivityRailWhenNotepadOnly: persistedSettings.hideActivityRailWhenNotepadOnly,
      });
    }

    await loadProjectTreeRoot();

    await runStartupExternalChecks();
    lastSelectedTabId = appState.getSnapshot().session.selectedTabId;
    runtimeReady = true;
    await syncExternalFileWatcher(appState.getSnapshot());

    await currentWindow.onFocusChanged(async ({ payload }) => {
      if (payload) {
        await markWindowActive(currentWindowId);
        if (runtimeReady) {
          await runFocusExternalChecks();
        }
      }
    });

    const unlistenFileChanged = await listen<{ path: string }>(
      FILE_CHANGED_EVENT,
      async (event) => {
        if (!runtimeReady) {
          return;
        }
        await runWatcherExternalCheck(event.payload.path);
      },
    );

    const unlistenRecentFiles = await listenForRecentFilesChanges((recentFiles) => {
      if (shouldInitializeAppMenu(currentWindowId)) {
        void refreshOpenRecentMenu(recentFiles);
      }
    });

    const unlistenActivate = await listen<{ path: string }>(WINDOW_EVENT_ACTIVATE_FILE, async (event) => {
      try {
        await openAndActivatePath(event.payload.path);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown error";
        notify(`Failed to open routed file: ${message}`);
      }
    });

    const unlistenOpenedPaths = await listen<{ paths: string[] }>(APP_EVENT_OPENED_PATHS, async (event) => {
      await consumeOpenedPaths(event.payload.paths);
    });

    const initialOpenedPaths = await invoke<string[]>("take_pending_opened_paths");
    if (initialOpenedPaths.length > 0) {
      await consumeOpenedPaths(initialOpenedPaths);
    }

    const unlistenSelectTab = await listen<{ path: string }>(
      WINDOW_EVENT_SELECT_TAB_FOR_PATH,
      async (event) => {
        selectTabForNormalizedPath(event.payload.path);
      },
    );

    const unlistenTransfer = await listen<{ filePath: string | null; content: string; title: string }>(
      WINDOW_EVENT_TRANSFER_TAB,
      async (event) => {
        const documentId = appState.openTransferredTab(event.payload);
        if (event.payload.filePath && documentId) {
          await claimOpenFile(event.payload.filePath, currentWindowId, documentId);
          await initializeDocumentDiskState(documentId, event.payload.filePath);
        }
      },
    );

    const unlistenDestroyed = await listen(TauriEvent.WINDOW_DESTROYED, async (event) => {
      const destroyedWindowId =
        typeof event.payload === "string" ? event.payload : currentWindowId;
      if (destroyedWindowId === currentWindowId) {
        await releaseAllOpenFilesForWindow(currentWindowId);
      }
      await logDiagnostic({
        level: "warn",
        source: "frontend",
        timestamp: new Date().toISOString(),
        message: "window destroyed",
        metadata: { windowId: currentWindowId },
      });
    });

    const unlistenWindowResized = await currentWindow.onResized(() => {
      scheduleWindowBoundsPersistence();
    });
    const unlistenWindowMoved = await currentWindow.onMoved(() => {
      scheduleWindowBoundsPersistence();
    });
    await logDiagnostic({
      level: "info",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "app shell initialized",
      metadata: { windowId: currentWindowId },
    });

    return () => {
      runtimeReady = false;
      unlistenRecentFiles();
      unlistenActivate();
      unlistenSelectTab();
      unlistenOpenedPaths();
      unlistenTransfer();
      unlistenDestroyed();
      unlistenDragDrop();
      unlistenFileChanged();
      unlistenWindowResized();
      unlistenWindowMoved();
      if (windowBoundsTimer) {
        clearTimeout(windowBoundsTimer);
        windowBoundsTimer = null;
      }
      void clearFileWatcherPaths();
    };
  }

  function handleKeydown(event: KeyboardEvent): void {
    const command = keymapCommandForEvent(event);
    if (command === "app.toggleFindReplace") {
      event.preventDefault();
      runCommand(command);
      return;
    }
    if (
      (event.target as HTMLElement | null)?.closest(
        "input, textarea, [contenteditable=true]",
      )
    ) {
      return;
    }
    if (!command) {
      return;
    }

    event.preventDefault();
    runCommand(command);
  }

  function runGoToLine(): void {
    const line = Number(goToLineValue);
    if (!Number.isInteger(line) || line < 1) {
      notify("Go-to line must be a positive integer.");
      return;
    }
    const moved = editorRunner?.goToLine(line) ?? false;
    notify(moved ? `Moved to line ${line}.` : "Line is out of range.");
  }

  onMount(() => {
    let runtimeCleanup: (() => void) | undefined;
    let resizeObserverDisconnected = false;

    const setupLayoutObserver = (): void => {
      updateLayoutMeasurements();
      if (typeof ResizeObserver === "undefined") {
        return;
      }
      layoutResizeObserver = new ResizeObserver(() => {
        updateLayoutMeasurements();
      });
      if (shellMainRowEl) {
        layoutResizeObserver.observe(shellMainRowEl);
      }
      if (editorPaneEl) {
        layoutResizeObserver.observe(editorPaneEl);
      }
    };

    void tick().then(() => {
      if (!resizeObserverDisconnected) {
        setupLayoutObserver();
      }
    });

    void setupRuntime()
      .then((cleanup) => {
        runtimeCleanup = cleanup;
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        await logDiagnostic({
          level: "error",
          source: "frontend",
          timestamp: new Date().toISOString(),
          message: "setupRuntime failed",
          metadata: { error: message },
        });
      });

    const search = new URLSearchParams(window.location.search);
    const openParam = search.get("open");
    if (openParam) {
      void routePathToLastActiveWindow(openParam)
        .then(() => {
          notify("File open routed to last active window.");
        })
        .catch(async () => {
          const self = getCurrentWebviewWindow().label;
          if (self !== "main") {
            return;
          }
          await openAndActivatePath(openParam);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "unknown error";
          notify(`Failed to open file from path: ${message}`);
        });
    }

    function onKeydown(event: KeyboardEvent): void {
      handleKeydown(event);
    }

    function preventBrowserDragOver(event: DragEvent): void {
      event.preventDefault();
    }

    window.addEventListener("keydown", onKeydown);
    window.addEventListener("dragover", preventBrowserDragOver);
    return () => {
      resizeObserverDisconnected = true;
      layoutResizeObserver?.disconnect();
      layoutResizeObserver = null;
      if (untitledTitleDebounceTimer) {
        clearTimeout(untitledTitleDebounceTimer);
        untitledTitleDebounceTimer = null;
      }
      runtimeCleanup?.();
      teardownSplitScrollSync();
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("dragover", preventBrowserDragOver);
    };
  });

  $: if (activeContextId) {
    handleActiveContextSwitch(activeContextId);
  }

  $: applyResponsiveLayoutRules();

  $: if (isMarkdownDocument && activeDocument) {
    if (lastMarkdownDocumentId !== activeDocument.id) {
      setMarkdownViewMode("edit");
      lastMarkdownDocumentId = activeDocument.id;
    }
  }

  $: if (!isMarkdownDocument) {
    setMarkdownViewMode("edit");
    lastMarkdownDocumentId = null;
  }

  $: if (isMarkdownDocument && preferredMarkdownViewMode === "split") {
    markdownViewMode = canFitMarkdownSplit() ? "split" : "edit";
  }

  $: if (isMarkdownDocument && markdownViewMode === "split") {
    void setupSplitScrollSync();
  } else {
    teardownSplitScrollSync();
  }

  $: if (state) {
    scheduleSessionPersistence(state, currentWindowId);
    if (currentWindowId) {
      void savePersistedSettings(
        toPersistedSettings({
          theme: state.settings.theme,
          wrapLines: state.editor.wrapLines,
          zoomPercent: state.editor.zoomPercent,
          externalFiles: state.settings.externalFiles,
          decoratePlaintextSymbols: state.settings.decoratePlaintextSymbols,
          hideActivityRailWhenNotepadOnly: state.settings.hideActivityRailWhenNotepadOnly,
        }),
      );
    }
  }

  $: if (activeWorkspaceRoot) {
    void loadProjectTreeRoot();
  }

  $: if (activeDocumentPath) {
    expandAncestorsForActiveFile(activeDocumentPath);
  }

  $: if (activeDocumentPath && activeWorkspaceRoot) {
    const normalizedRoot = normalizePathSync(activeWorkspaceRoot).replace(/\/+$/, "");
    if (activeDocumentPath.startsWith(`${normalizedRoot}/`)) {
      const relative = activeDocumentPath.slice(normalizedRoot.length + 1);
      const segments = relative.split("/").filter(Boolean);
      if (segments.length > 1) {
        let cursor = normalizedRoot;
        for (const segment of segments.slice(0, -1)) {
          cursor = `${cursor}/${segment}`;
          if (!projectTreeChildrenByPath.has(cursor) && !projectTreeLoadingPaths.has(cursor)) {
            void loadProjectTreeChildren(cursor);
          }
        }
      }
    }
  }
</script>

<main class="shell">
  <div class="shell-main-row" bind:this={shellMainRowEl}>
    {#if showActivityRail}
      <ActivityRail
        workspaces={workspaces}
        activeContextId={activeContextId}
        onSelectContext={handleSelectContext}
        onAddWorkspace={handleAddWorkspace}
        onRequestCloseWorkspace={handleOpenWorkspaceContextMenu}
      />
    {/if}
    <section class="editor-shell" bind:this={editorShellEl}>
      <header class="tab-header">
    <div class="header-left">
      <TabBar
        openTabs={state.session.openTabs}
        documents={state.documents}
        selectedTabId={state.session.selectedTabId}
        windowId={currentWindowId}
      />
      <button
        class="toolbar-button add-file-button"
        type="button"
        aria-label="Create new untitled file"
        title="New Untitled File"
        onclick={() => runCommand("file.new")}
      >
        +
      </button>
    </div>
    <div class="header-right">
      <button class="toolbar-button" type="button" onclick={() => runCommand("app.toggleSettingsPane")}>
        Settings
      </button>
    </div>
      </header>

      <section class="editor-pane" bind:this={editorPaneEl}>
    {#if state.editor.previewMode === "editor"}
      {#if isMarkdownDocument}
        <div class="markdown-layout">
          <div class="markdown-mode-bar">
            <div class="markdown-mode-actions">
              <button
                class={`mode-button ${markdownViewMode === "edit" ? "mode-button-active" : ""}`}
                type="button"
                onclick={() => setMarkdownViewMode("edit")}
              >
                edit
              </button>
              <button
                class={`mode-button ${markdownViewMode === "split" ? "mode-button-active" : ""}`}
                type="button"
                onclick={() => setMarkdownViewMode("split")}
              >
                split
              </button>
              <button
                class={`mode-button ${markdownViewMode === "preview" ? "mode-button-active" : ""}`}
                type="button"
                onclick={() => setMarkdownViewMode("preview")}
              >
                preview
              </button>
            </div>
          </div>

          {#if markdownViewMode === "preview"}
            <div class="markdown-preview markdown-preview-standalone">{@html markdownHtml}</div>
          {:else if markdownViewMode === "split"}
            <div class="markdown-split">
              <div class="markdown-editor-pane" bind:this={markdownEditorPaneEl}>
                <EditorSurface
                  content={activeDocument?.content ?? ""}
                  documentId={activeDocument?.id ?? null}
                  scrollTop={activeDocument?.scrollTop ?? 0}
                  wrapLines={state.editor.wrapLines}
                  zoomPercent={state.editor.zoomPercent}
                  language={activeDocument?.language ?? "plaintext"}
                  decoratePlaintextSymbols={state.settings.decoratePlaintextSymbols}
                  onStatusMessage={notify}
                  onDocumentDirty={(nextContent) => {
                    if (!activeDocument) {
                      return;
                    }
                    appState.setDocumentContent(activeDocument.id, nextContent);
                    scheduleUntitledTitleRefresh(activeDocument.id);
                  }}
                  onScrollTopChange={handleDocumentScrollTop}
                  registerEditorCommandRunner={(runner) => {
                    editorRunner = runner;
                  }}
                />
              </div>
              <div class="markdown-preview markdown-preview-pane" bind:this={markdownPreviewPaneEl}>
                {@html markdownHtml}
              </div>
            </div>
          {:else}
            <div class="markdown-editor-single">
              <EditorSurface
                content={activeDocument?.content ?? ""}
                documentId={activeDocument?.id ?? null}
                scrollTop={activeDocument?.scrollTop ?? 0}
                wrapLines={state.editor.wrapLines}
                zoomPercent={state.editor.zoomPercent}
                language={activeDocument?.language ?? "plaintext"}
                decoratePlaintextSymbols={state.settings.decoratePlaintextSymbols}
                onStatusMessage={notify}
                onDocumentDirty={(nextContent) => {
                  if (!activeDocument) {
                    return;
                  }
                  appState.setDocumentContent(activeDocument.id, nextContent);
                  scheduleUntitledTitleRefresh(activeDocument.id);
                }}
                onScrollTopChange={handleDocumentScrollTop}
                registerEditorCommandRunner={(runner) => {
                  editorRunner = runner;
                }}
              />
            </div>
          {/if}
        </div>
      {:else}
        <EditorSurface
          content={activeDocument?.content ?? ""}
          documentId={activeDocument?.id ?? null}
          scrollTop={activeDocument?.scrollTop ?? 0}
          wrapLines={state.editor.wrapLines}
          zoomPercent={state.editor.zoomPercent}
          language={activeDocument?.language ?? "plaintext"}
          decoratePlaintextSymbols={state.settings.decoratePlaintextSymbols}
          onStatusMessage={notify}
          onDocumentDirty={(nextContent) => {
            if (!activeDocument) {
              return;
            }
            appState.setDocumentContent(activeDocument.id, nextContent);
            scheduleUntitledTitleRefresh(activeDocument.id);
          }}
          onScrollTopChange={handleDocumentScrollTop}
          registerEditorCommandRunner={(runner) => {
            editorRunner = runner;
          }}
        />
      {/if}
    {:else if state.editor.previewMode === "markdown"}
      <div class="preview-panel">
        <div class="preview-title">Markdown Preview</div>
        <div class="markdown-preview">{@html markdownHtml}</div>
      </div>
    {:else}
      <div class="preview-panel diff-preview">
        <div class="preview-title">Diff Preview (saved vs current)</div>
        <div class="diff-grid">
          <div class="diff-column">
            <h4>Saved</h4>
            {#each diffRows as row}
              <pre class={`diff-row ${row.added ? "row-added" : row.removed ? "row-removed" : ""}`}>
{row.removed ? row.value : row.added ? "" : row.value}</pre>
            {/each}
          </div>
          <div class="diff-column">
            <h4>Current</h4>
            {#each diffRows as row}
              <pre class={`diff-row ${row.added ? "row-added" : row.removed ? "row-removed" : ""}`}>
{row.added ? row.value : row.removed ? "" : row.value}</pre>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#if state.editor.findReplaceOpen}
      <FindReplacePanel
        bind:findQuery
        bind:replaceValue
        bind:findCaseSensitive
        {editorRunner}
        {notify}
        documentId={activeDocument?.id ?? null}
      />
    {/if}

    {#if state.editor.goToOpen}
      <div class="floating-tool goto-tool">
        <h3>Go To Line</h3>
        <input placeholder="Line number..." bind:value={goToLineValue} />
        <div class="tool-actions">
          <button type="button" class="toolbar-button" onclick={runGoToLine}>Go</button>
          <button type="button" class="toolbar-button" onclick={() => appState.setGoToOpen(false)}>
            Close
          </button>
        </div>
      </div>
    {/if}
        <aside class="settings-pane" data-open={settingsPaneOpen}>
      <h2>Settings</h2>
      <section class="settings-section">
        <h3>Theme</h3>
        {#each APP_THEME_IDS as themeId}
          <label class="settings-theme-row">
            <input
              type="radio"
              name="theme"
              value={themeId}
              checked={state.settings.theme === themeId}
              onchange={() => appState.setTheme(themeId)}
            />
            <span class="theme-swatch" style="background-color: {getThemeAccentHex(themeId)}"></span>
            <span>{getThemeLabel(themeId)}</span>
          </label>
        {/each}
      </section>
      <section class="settings-section">
        <h3>External files</h3>
        <label class="settings-toggle">
          <input
            type="checkbox"
            checked={state.settings.externalFiles.watchExternalChanges}
            onchange={(event) =>
              updateExternalFilesSetting(
                "watchExternalChanges",
                (event.currentTarget as HTMLInputElement).checked,
              )}
          />
          Watch external file changes
        </label>
        <label class="settings-toggle">
          <input
            type="checkbox"
            checked={state.settings.externalFiles.autoReloadCleanFiles}
            disabled={!state.settings.externalFiles.watchExternalChanges}
            onchange={(event) =>
              updateExternalFilesSetting(
                "autoReloadCleanFiles",
                (event.currentTarget as HTMLInputElement).checked,
              )}
          />
          Reload clean files automatically
        </label>
        <label class="settings-toggle">
          <input
            type="checkbox"
            checked={state.settings.externalFiles.checkOnWindowFocus}
            disabled={!state.settings.externalFiles.watchExternalChanges}
            onchange={(event) =>
              updateExternalFilesSetting(
                "checkOnWindowFocus",
                (event.currentTarget as HTMLInputElement).checked,
              )}
          />
          Check when window gains focus
        </label>
        <label class="settings-toggle">
          <input
            type="checkbox"
            checked={state.settings.externalFiles.checkOnTabActivate}
            disabled={!state.settings.externalFiles.watchExternalChanges}
            onchange={(event) =>
              updateExternalFilesSetting(
                "checkOnTabActivate",
                (event.currentTarget as HTMLInputElement).checked,
              )}
          />
          Check when tab becomes active
        </label>
      </section>
      <section class="settings-section">
        <h3>Editor</h3>
        <label class="settings-toggle">
          <input
            type="checkbox"
            checked={state.settings.decoratePlaintextSymbols}
            onchange={(event) =>
              appState.setDecoratePlaintextSymbols(
                (event.currentTarget as HTMLInputElement).checked,
              )
            }
          />
          Decorate plaintext symbols
        </label>
        <label class="settings-toggle">
          <input
            type="checkbox"
            checked={state.settings.hideActivityRailWhenNotepadOnly}
            onchange={(event) =>
              appState.setHideActivityRailWhenNotepadOnly(
                (event.currentTarget as HTMLInputElement).checked,
              )}
          />
          Hide activity rail when Notepad only
        </label>
      </section>
      <p>This pane uses token-driven overlay styling.</p>
        </aside>
      </section>
    </section>
    {#if activeWorkspaceRoot}
      <ProjectPanel
        workspaceRoot={activeWorkspaceRoot}
        rootNodes={projectTreeRootNodes}
        expandedPaths={projectTreeExpandedPaths}
        childrenByPath={projectTreeChildrenByPath}
        loadingPaths={projectTreeLoadingPaths}
        activeFilePath={activeDocumentPath}
        showHidden={projectTreeShowHidden}
        collapsed={!showProjectPanel}
        onRefresh={refreshProjectTree}
        onToggleHidden={toggleProjectTreeHidden}
        onToggleCollapsed={toggleProjectPanelCollapsed}
        onToggleDirectory={handleToggleProjectTreeDirectory}
        onOpenFile={handleOpenProjectTreeFile}
      />
    {/if}
  </div>

  <div class="bottom-panel">
    {#if consoleOpen}
      <ConsolePanel />
    {/if}

    <footer class="status-bar" class:status-bar-console-open={consoleOpen}>
      <button
        type="button"
        class="status-bar-button"
        title={consoleOpen ? "Hide console" : "Show console"}
        onclick={toggleConsole}
      >
        <span class="status-segment optional-segment optional-cursor">
          Ln {state.editor.cursorLine}, Col {state.editor.cursorColumn}
        </span>
        <span class="status-segment optional-segment optional-encoding">
          {activeDocument?.encoding.toUpperCase() ?? "UTF-8"}
        </span>
        <span class="status-segment optional-segment optional-line-ending">
          {activeDocument?.lineEnding.toUpperCase() ?? "LF"}
        </span>
        <span class="status-segment optional-segment optional-zoom">
          {state.editor.zoomPercent}%
        </span>
        <span class="status-segment optional-segment optional-wrap">
          {state.editor.wrapLines ? "Wrap: On" : "Wrap: Off"}
        </span>
        <span class="status-segment">{activeDocument?.isDirty ? "Modified" : "Saved"}</span>
        {#if activeDocument?.fileMissing}
          <span class="status-segment status-missing" title="File no longer exists on disk">
            File missing
          </span>
        {/if}
        <span class="status-segment status-message optional-segment optional-message">{statusMessage}</span>
        <span class="status-segment path-segment" title={activeDocument?.filePath ?? statusPath}>
          {statusPath}
        </span>
      </button>
    </footer>
  </div>

</main>

{#if workspaceContextMenu}
  <div
    bind:this={workspaceContextMenuEl}
    class="workspace-context-menu"
    style={`left:${workspaceContextMenu.x}px; top:${workspaceContextMenu.y}px;`}
    role="menu"
    tabindex="-1"
    onpointerdown={(event) => event.stopPropagation()}
  >
    <button
      class="workspace-context-item"
      type="button"
      role="menuitem"
      onpointerdown={(event) => {
        event.stopPropagation();
        if (!workspaceContextMenu) {
          return;
        }
        closeWorkspaceFromContextMenu(workspaceContextMenu.workspaceId);
      }}
    >
      Close Workspace
    </button>
  </div>
{/if}

<style>
  .shell {
    height: 100vh;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    background: var(--color-bg-root);
    color: var(--color-text-primary);
  }

  .shell-main-row {
    min-height: 0;
    display: grid;
    grid-template-columns:
      auto
      minmax(var(--editor-min-width), 1fr)
      auto;
  }

  .editor-shell {
    grid-column: 2;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: var(--tab-header-height) minmax(0, 1fr);
  }

  .shell-main-row :global(.project-panel) {
    grid-column: 3;
  }

  .bottom-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .tab-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-8);
    padding: 0 var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
  }

  .header-left,
  .header-right {
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }

  .toolbar-button,
  .status-segment,
  .menu-action {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    height: calc(var(--tab-header-height) - var(--space-8));
    padding: 0 var(--space-8);
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      border-color var(--motion-fast) var(--easing-standard);
  }

  .editor-pane {
    position: relative;
    padding: var(--space-8);
    overflow: hidden;
  }

  .markdown-layout {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-height: 0;
  }

  .markdown-mode-bar {
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
  }

  .markdown-mode-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .mode-button {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    height: 18px;
    font-size: 11px;
    text-transform: lowercase;
    padding: 0 var(--space-6);
  }

  .mode-button-active {
    color: var(--color-text-primary);
    border-color: var(--color-border-subtle);
    background: var(--color-hover);
  }

  .markdown-editor-single {
    flex: 1;
    min-height: 0;
  }

  .markdown-split {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-8);
  }

  .markdown-editor-pane {
    min-height: 0;
  }

  .markdown-preview-pane,
  .markdown-preview-standalone {
    min-height: 0;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    overflow: auto;
  }

  .preview-panel {
    height: 100%;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .preview-title {
    padding: var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .markdown-preview {
    padding: var(--space-12);
    overflow: auto;
    line-height: 1.55;
  }

  .diff-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-8);
    height: 100%;
    padding: var(--space-8);
    overflow: auto;
  }

  .diff-column {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    overflow: auto;
  }

  .diff-column h4 {
    margin: 0;
    padding: var(--space-6) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
    font-size: var(--font-size-status);
  }

  .diff-row {
    margin: 0;
    padding: var(--space-2) var(--space-8);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .row-added {
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
  }

  .row-removed {
    background: color-mix(in srgb, #c53030 18%, transparent);
  }

  .floating-tool {
    position: absolute;
    top: var(--space-12);
    left: var(--space-12);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-8);
    display: grid;
    gap: var(--space-6);
  }

  .goto-tool {
    width: 240px;
  }

  .floating-tool input {
    height: 30px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0 var(--space-8);
  }

  .tool-checkbox {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    font-size: var(--font-size-status);
  }

  .tool-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin-top: var(--space-8);
  }

  .settings-section h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .settings-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    font-size: 0.875rem;
  }

  .settings-toggle input {
    accent-color: var(--accent-color);
  }

  .settings-theme-row {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    font-size: 0.875rem;
    padding: var(--space-2) 0;
  }

  .theme-swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .settings-pane {
    position: absolute;
    top: var(--space-8);
    right: var(--space-8);
    width: var(--settings-pane-width);
    max-width: calc(100% - var(--space-8) * 2);
    height: calc(100% - var(--space-8) * 2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-12);
    transform: translateX(110%);
    opacity: 0;
    pointer-events: none;
    transition:
      transform var(--motion-medium) var(--easing-emphasized),
      opacity var(--motion-medium) var(--easing-standard);
  }

  .settings-pane[data-open="true"] {
    transform: translateX(0);
    opacity: 1;
    pointer-events: auto;
  }

  .workspace-context-menu {
    position: fixed;
    z-index: 1100;
    min-width: 180px;
    padding: var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-overlay);
  }

  .workspace-context-item {
    display: block;
    width: 100%;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    text-align: left;
    font: inherit;
    padding: var(--space-4) var(--space-6);
  }

  .workspace-context-item:hover {
    background: var(--color-hover);
    cursor: pointer;
  }

  .status-bar {
    flex-shrink: 0;
    height: var(--statusbar-height);
    overflow: hidden;
    background: var(--color-statusbar-bg);
    border-top: 1px solid var(--color-border-subtle);
  }

  .status-bar-button {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    overflow: hidden;
    gap: var(--space-4);
    width: 100%;
    height: 100%;
    padding: 0 var(--space-8);
    border: none;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: var(--font-size-status);
    cursor: pointer;
    text-align: left;
  }

  .status-bar-button:hover {
    background: var(--color-hover);
  }

  .status-bar-button:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }

  .status-bar-console-open {
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--color-accent) 35%, transparent);
  }

  .status-segment {
    display: inline-flex;
    align-items: center;
    height: calc(var(--statusbar-height) - var(--space-4));
    font-size: var(--font-size-status);
    line-height: 1;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .status-missing {
    color: #e06c75;
    border-color: color-mix(in srgb, #e06c75 35%, transparent);
  }

  .status-message {
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .path-segment {
    margin-left: auto;
    white-space: nowrap;
    overflow: visible;
    text-overflow: clip;
  }

  .add-file-button {
    min-width: 32px;
    width: 32px;
    padding: 0;
    font-size: 16px;
    line-height: 1;
  }

  @media (max-width: 1100px) {
    .optional-message {
      display: none;
    }
  }

  @media (max-width: 900px) {
    .optional-wrap,
    .optional-zoom {
      display: none;
    }
  }

  @media (max-width: 760px) {
    .optional-line-ending,
    .optional-encoding {
      display: none;
    }
  }

  @media (max-width: 620px) {
    .optional-cursor {
      display: none;
    }
  }

  @media (max-width: 480px) {
    .status-segment:not(.path-segment) {
      display: none;
    }

    .optional-segment {
      display: none;
    }

    .path-segment {
      margin-left: 0;
      max-width: 100%;
    }
  }

  .tab-header {
    min-width: 0;
  }

  .header-left {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .header-right {
    flex-shrink: 0;
  }

  .path-segment:focus-visible,
  .path-segment:hover {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .command-demo {
    position: absolute;
    inset: auto auto calc(var(--statusbar-height) + var(--space-8)) var(--space-8);
    display: flex;
    gap: var(--space-6);
  }

  .toolbar-button:hover,
  .status-segment:hover,
  .menu-action:hover {
    background: var(--color-hover);
    cursor: pointer;
  }

  .toolbar-button:focus-visible,
  .status-segment:focus-visible,
  .menu-action:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .toolbar-button:active,
  .status-segment:active,
  .menu-action:active {
    background: var(--color-pressed);
  }

  :global(.cm-plaintext-symbol) {
    color: var(--color-accent);
    opacity: 0.85;
  }
</style>
