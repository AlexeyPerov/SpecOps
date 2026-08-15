<script lang="ts">
  /**
   * AppShellHost — the thin "core wiring" wrapper that sits between
   * `+page.svelte` and `AppShell.svelte`. It receives:
   *
   *   - the snapshot-derived values the page computes (activeContext, session,
   *     documents, documentView, layout flags, workspaces, …),
   *   - the already-extracted handler bundles (agent / editor / file / layout
   *     / project-tree / command / workspace-context-menu handlers),
   *   - the editor workbench + tools singletons,
   *   - the `OverlayHost` instance (so this wrapper can feed the AppShell-
   *     rendered overlays — project search + workspace context menu — from
   *     the host's exposed state, and read its imperative API).
   *
   * What used to be ~370 lines of inline `<AppShell editor={{...}} .../>`
   * prop wiring in `+page.svelte` now lives here. The page just mounts
   * `<AppShellHost .../>` and stays focused on the reactive graph + the
   * cross-cutting `$effect`s (L14).
   *
   * The DOM-element `bind:this` refs (`shellMainRowEl`, `editorShellEl`,
   * `editorPaneEl`, `workspaceContextMenuEl`) are `$bindable` so the page's
   * layout observers and effects can still see them.
   */
  import AppShell from "./AppShell.svelte";
  import type { AppShellHostApi } from "./appShellHostTypes";
  import type { OverlayHostApi } from "./overlays/overlayHostTypes";
  import { collectPaneElementsFromDom } from "./paneDropTargets";
  import { activeViewKindInActivePane } from "./editorRouting";
  import { appState } from "../state/appState";
  import type {
    ChatMessage,
    ContextId,
    DocumentState,
    MarkdownViewMode,
    SessionIndexEntry,
    SessionState,
    WorkspaceEntry,
    WindowContextState,
  } from "../domain/contracts";
  import type { ProjectTreeControllerState } from "../services/projectTreeController";
  import type { createProjectTreeController } from "../services/projectTreeController";
  import type { AppShellDocumentView } from "../services/appShellDocumentView";
  import type { WorkspaceLayoutState } from "../domain/contracts";
  import type { EditorWorkbenchRuntime } from "../editor/editorWorkbenchRuntime";
  import type { EditorToolController } from "../editor/editorToolController";
  import type { WorkspaceFileCatalogRegistry } from "../services/workspaceFileCatalogRegistry";
  import type { WorkspaceFileCatalogSnapshot } from "../services/workspaceFileCatalog";
  import type { WorkspaceDirectoryCache } from "../services/workspaceDirectoryCache";
  import { directoriesToInvalidateForChange } from "../services/projectTreeController";
  import type { PaletteCommandEntry } from "../commands/catalog";
  import type { ResolvedMarkdownSnippet } from "../domain/snippets";
  import { createAppShellAgentHandlers } from "../services/appShellAgentHandlers";
  import {
    createAppShellCommandHandlers,
    createAppShellEditorHandlers,
    createAppShellFileHandlers,
  } from "../services/appShellPageHandlers";
  import { createAppShellLayoutHandlers } from "../services/appShellLayoutHandlers";
  import { createAppShellProjectTreeHandlers } from "../services/appShellProjectTreeHandlers";
  import { markActiveFileTreeExpandApplied } from "../services/appShellEffects";
  import { createWorkspaceContextMenuActions } from "../services/workspaceContextMenuController";
  import { normalizeActivityRailWidthPx } from "../services/panelLayout";

  /** Closed / empty project-search state — used before OverlayHost mounts. */
  const IDLE_PROJECT_SEARCH: import("./overlays/overlayHostTypes").ProjectSearchPanelState = {
    open: false,
    heightPx: 0,
    focusNonce: 0,
    focusReplace: false,
    query: "",
    replaceValue: "",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    queryError: "",
    results: [],
    running: false,
    status: "",
  };

  // Re-export so +page.svelte can `import type { AppShellHostBound }`.
  export type { AppShellHostBound } from "./appShellHostTypes";

  type ProjectTreeController = ReturnType<typeof createProjectTreeController>;

  type OverlayHostBound = import("./overlays/overlayHostTypes").OverlayHostBound;

  interface Props {
    // --- DOM refs (bindable upward to the page) ---
    shellMainRowEl: HTMLDivElement | null;
    editorShellEl: HTMLElement | null;
    editorPaneEl: HTMLElement | null;
    workspaceContextMenuEl: HTMLDivElement | null;
    consoleHeightPx: number;
    consoleOpen: boolean;
    shellMainRowWidth: number;
    editorPaneWidth: number;
    autoProjectPanelCollapsed: boolean;
    autoSessionsSidebarCollapsed: boolean;

    // --- Editor chrome (L15 leaf selectors) ---
    activityRailWidthPx: number;
    editorPreviewMode: MarkdownViewMode;
    editorWrapLines: boolean;
    editorZoomPercent: number;
    editorCursorLine: number;
    editorCursorColumn: number;
    editorSelectionCount: number;
    decoratePlaintextSymbols: boolean;
    showMinimap: boolean;
    showFoldGutter: boolean;
    autoClosePairs: boolean;
    autoSuggest: boolean;
    maxBinaryOpenAsTextBytes: number;
    maxOpenWithoutConfirmBytes: number;

    contexts: WindowContextState;
    activeContextId: ContextId;
    session: SessionState;
    documents: DocumentState[];
    activeDocument: DocumentState | undefined;
    activeMessages: readonly ChatMessage[];
    activeWorkspaceRoot: string | null;
    documentView: AppShellDocumentView;
    workspaceLayout: WorkspaceLayoutState;
    workspaces: WorkspaceEntry[];
    railWorkspaces: WorkspaceEntry[];
    workspaceSessions: SessionIndexEntry[];
    selectedSessionId: string | null;
    activeSessionEntry: SessionIndexEntry | null;
    workspaceHiddenRootPaths: Set<string>;
    projectTreeControllerState: ProjectTreeControllerState;
    fileStatusByPath:
      | ReadonlyMap<string, import("../ai/backends/workspaceAgentBackend").OpencodeFileChangeStatus>
      | null;
    showProjectPanel: boolean;
    showSessionsSidebar: boolean;
    isSessionTabActive: boolean;
    currentWindowId: string;
    notepadOpenTabCount: number;
    notepadRecentTabs: { tabId: string; label: string }[];
    fileDropTargetPaneId: string | null;
    statusMessage: string;
    openSessionIds: ReadonlySet<string>;

    // --- Settings-derived flags ---
    opencodeEnabled: boolean;
    canOpenLogsPanel: boolean;

    // --- fileDropTargetPaneId setter (page-owned state) ---
    onFileDropPaneChange: (paneId: string | null) => void;

    // --- Editor + catalog singletons ---
    editorWorkbench: EditorWorkbenchRuntime;
    editorTools: EditorToolController;
    projectTreeController: ProjectTreeController;
    workspaceDirectoryCache: WorkspaceDirectoryCache;
    workspaceFileCatalogRegistry: WorkspaceFileCatalogRegistry;
    runtimeReady: boolean;

    // --- Overlay host (page-mounted; this wrapper reads its exposed state) ---
    overlayHost: OverlayHostBound | null;

    // --- Misc page-owned helpers ---
    notify: (message: string) => void;
    handleSelectNotepadTab: (tabId: string) => void;

    // --- Picker input snapshots fed into OverlayHost ---
    quickOpenCatalogSnapshot: WorkspaceFileCatalogSnapshot;
    quickOpenRecencyInputs: { openPaths: string[]; recentPaths: readonly string[] };
    commandPaletteEntries: PaletteCommandEntry[];
    markdownSnippets: ResolvedMarkdownSnippet[];
  }

  let {
    shellMainRowEl = $bindable(null),
    editorShellEl = $bindable(null),
    editorPaneEl = $bindable(null),
    workspaceContextMenuEl = $bindable(null),
    consoleHeightPx = $bindable(0),
    consoleOpen = $bindable(false),
    shellMainRowWidth = $bindable(0),
    editorPaneWidth = $bindable(0),
    autoProjectPanelCollapsed = $bindable(false),
    autoSessionsSidebarCollapsed = $bindable(false),
    activityRailWidthPx,
    editorPreviewMode,
    editorWrapLines,
    editorZoomPercent,
    editorCursorLine,
    editorCursorColumn,
    editorSelectionCount,
    decoratePlaintextSymbols,
    showMinimap,
    showFoldGutter,
    autoClosePairs,
    autoSuggest,
    maxBinaryOpenAsTextBytes,
    maxOpenWithoutConfirmBytes,
    contexts,
    activeContextId,
    session,
    documents,
    activeDocument,
    activeMessages,
    activeWorkspaceRoot,
    documentView,
    workspaceLayout,
    workspaces,
    railWorkspaces,
    workspaceSessions,
    selectedSessionId,
    activeSessionEntry,
    workspaceHiddenRootPaths,
    projectTreeControllerState,
    fileStatusByPath,
    showProjectPanel,
    showSessionsSidebar,
    isSessionTabActive,
    currentWindowId,
    notepadOpenTabCount,
    notepadRecentTabs,
    fileDropTargetPaneId,
    statusMessage,
    openSessionIds,
    opencodeEnabled,
    canOpenLogsPanel,
    onFileDropPaneChange,
    editorWorkbench,
    editorTools,
    projectTreeController,
    workspaceDirectoryCache,
    workspaceFileCatalogRegistry,
    runtimeReady,
    overlayHost,
    notify,
    handleSelectNotepadTab,
    quickOpenCatalogSnapshot,
    quickOpenRecencyInputs,
    commandPaletteEntries,
    markdownSnippets,
  }: Props = $props();

  let layoutResizeObserver = $state<ResizeObserver | null>(null);
  let previousActiveContextId = $state<ContextId | null>(null);
  let largeFileConfirming = $state(false);
  let untitledTitleDebounceTimer = $state<ReturnType<typeof setTimeout> | null>(null);

  const projectTreeHandlers = createAppShellProjectTreeHandlers({
    getActiveWorkspaceRoot: () => activeWorkspaceRoot,
    getIsSessionTabActive: () => isSessionTabActive,
    getCurrentWindowId: () => currentWindowId,
    notify: (message) => notify(message),
    get projectTreeController() {
      return projectTreeController;
    },
    onFilesystemChange: (path, kind) => {
      for (const workspace of appState.getSnapshot().contexts.workspaces) {
        workspaceDirectoryCache.invalidate(
          directoriesToInvalidateForChange(workspace.rootPath, path),
        );
      }
      workspaceFileCatalogRegistry.notifyFilesystemChange(path, kind);
    },
    onBeforeProjectTreeRefresh: () => {
      workspaceDirectoryCache.clear();
    },
    getActiveDocumentPath: () => documentView.activeDocumentPath,
    suppressActiveFileTreeExpand: (workspaceRoot, documentPath) =>
      markActiveFileTreeExpandApplied(workspaceRoot, documentPath),
  });

  const layoutHandlers = createAppShellLayoutHandlers({
    getShellMainRowEl: () => shellMainRowEl,
    getEditorPaneEl: () => editorPaneEl,
    setShellMainRowWidth: (width) => {
      shellMainRowWidth = width;
    },
    setEditorPaneWidth: (width) => {
      editorPaneWidth = width;
    },
    getShellMainRowWidth: () => shellMainRowWidth,
    getEditorPaneWidth: () => editorPaneWidth,
    getActiveWorkspaceRoot: () => activeWorkspaceRoot,
    getIsSessionTabActive: () => isSessionTabActive,
    getWorkspaceLayout: () => workspaceLayout,
    getConsoleOpen: () => consoleOpen,
    setConsoleOpen: (open) => {
      consoleOpen = open;
    },
    getAutoProjectPanelCollapsed: () => autoProjectPanelCollapsed,
    setAutoProjectPanelCollapsed: (collapsed) => {
      autoProjectPanelCollapsed = collapsed;
    },
    getAutoSessionsSidebarCollapsed: () => autoSessionsSidebarCollapsed,
    setAutoSessionsSidebarCollapsed: (collapsed) => {
      autoSessionsSidebarCollapsed = collapsed;
    },
    getActiveDocument: () => activeDocument,
    getConsoleHeightPx: () => consoleHeightPx,
    setConsoleHeightPx: (heightPx) => {
      consoleHeightPx = heightPx;
    },
    getLayoutResizeObserver: () => layoutResizeObserver,
    setLayoutResizeObserver: (observer) => {
      layoutResizeObserver = observer;
    },
  });

  // H33: `editorPaneEl` is rewritten by EditorPaneContent on every active-pane
  // change; re-point the layout ResizeObserver at the new element (the setup
  // pass only observed the element present at mount, so pane switches left a
  // detached element observed and `editorPaneWidth` permanently stale).
  $effect(() => {
    editorPaneEl;
    layoutHandlers.syncEditorPaneObserved();
  });

  const agentHandlers = createAppShellAgentHandlers({
    getCurrentWindowId: () => currentWindowId,
    notify: (message) => notify(message),
  });

  const workspaceContextMenuActions = createWorkspaceContextMenuActions({
    getMenu: () => overlayHost?.workspaceContextMenu ?? null,
    setMenu: (menu) => {
      if (menu) {
        overlayHost?.api.openWorkspaceContextMenu(menu.workspaceId, menu.x, menu.y);
      } else {
        overlayHost?.api.closeOverlay("workspaceContextMenu");
      }
    },
    getMenuEl: () => workspaceContextMenuEl,
    getWorkspaceIds: () => workspaces.map((workspace) => workspace.id),
    getPreviousActiveContextId: () => previousActiveContextId,
    setPreviousActiveContextId: (contextId) => {
      previousActiveContextId = contextId;
    },
    setConsoleOpen: (open) => {
      consoleOpen = open;
    },
    setMarkdownViewMode: layoutHandlers.setMarkdownViewMode,
    loadProjectTreeRoot: projectTreeHandlers.loadProjectTreeRoot,
    notify: (message) => notify(message),
  });

  // Detach the workspace context menu's window listeners when this host is
  // destroyed, so a menu left open on unmount does not leak pointer/keydown
  // handlers for the page lifetime (L21).
  $effect(() => {
    return () => {
      workspaceContextMenuActions.detach();
    };
  });

  const commandHandlers = createAppShellCommandHandlers({
    notify: (message) => notify(message),
    getSnapshot: () => appState.getSnapshot(),
    getCurrentWindowId: () => currentWindowId,
    getEditorRunner: () => editorWorkbench.getActiveRunner(),
    getEditorTools: () => editorTools,
    // H30: keyboard routing only defers to *modal* overlays; the persistent
    // Find-in-Project panel / context menu must not kill global shortcuts.
    getOverlayOpen: () => overlayHost?.api.isModalOverlayOpen() ?? false,
    openProjectSearch: (focusReplace) => {
      overlayHost?.api.openOverlay("projectSearch", { focusReplace });
    },
    openQuickOpen: () => overlayHost?.api.openOverlay("quickOpen"),
    openHeadingJump: () => overlayHost?.api.openOverlay("headingJump"),
    openBookmarkList: () => overlayHost?.api.openOverlay("bookmarkList"),
    openSnippetInsert: () => overlayHost?.api.openOverlay("snippetInsert"),
    openCommandPalette: () => overlayHost?.api.openOverlay("commandPalette"),
    setConsoleOpen: (open) => {
      consoleOpen = open;
    },
  });

  const fileHandlers = createAppShellFileHandlers({
    getCurrentWindowId: () => currentWindowId,
    getRuntimeReady: () => runtimeReady,
    notify: (message) => notify(message),
  });

  const editorHandlers = createAppShellEditorHandlers({
    getDocument: (documentId) =>
      documents.find((documentState) => documentState.id === documentId),
    getLargeFileConfirming: () => largeFileConfirming,
    setLargeFileConfirming: (value) => {
      largeFileConfirming = value;
    },
    getGoToLineValue: () => editorTools.getSnapshot().goToLineValue,
    getEditorRunner: () => editorWorkbench.getActiveRunner(),
    getUntitledTitleDebounceTimer: () => untitledTitleDebounceTimer,
    setUntitledTitleDebounceTimer: (timer) => {
      untitledTitleDebounceTimer = timer;
    },
    notify: (message) => notify(message),
  });

  const api: AppShellHostApi = {
    runCommand: commandHandlers.runCommand,
    handleKeydown: commandHandlers.handleKeydown,
    onTabActivated: fileHandlers.onTabActivated,
    openAndActivatePath: fileHandlers.openAndActivatePath,
    consumeOpenedPaths: fileHandlers.consumeOpenedPaths,
    restoreWorkspaceSession: agentHandlers.restoreWorkspaceSession,
    loadProjectTreeRoot: projectTreeHandlers.loadProjectTreeRoot,
    notifyProjectTreeFilesystemChange: projectTreeHandlers.notifyProjectTreeFilesystemChange,
    setupLayoutObserver: layoutHandlers.setupLayoutObserver,
    disconnectLayoutObserver: layoutHandlers.disconnectLayoutObserver,
    clearUntitledTitleDebounceTimer: editorHandlers.clearUntitledTitleDebounceTimer,
    handleActiveContextSwitch: workspaceContextMenuActions.handleActiveContextSwitch,
    openSettingsFromContextMenu: workspaceContextMenuActions.openSettings,
    openVersionControlFromContextMenu: workspaceContextMenuActions.openVersionControl,
    canFitMarkdownSplit: layoutHandlers.canFitMarkdownSplit,
    toggleConsole: layoutHandlers.toggleConsole,
    applyResponsiveLayoutRules: layoutHandlers.applyResponsiveLayoutRules,
    setMarkdownViewMode: layoutHandlers.setMarkdownViewMode,
  };

  export { api };

  function handleAddWorkspace(): void {
    commandHandlers.runCommand("workspace.add");
  }

  function handleOpenWorkspaceManager(): void {
    commandHandlers.runCommand("app.openWorkspaceManager");
  }

  function handleSelectContext(contextId: ContextId): void {
    workspaceContextMenuActions.handleSelectContext(contextId);
  }

  function handleOpenWorkspaceSettingsFromManager(workspaceId: ContextId): void {
    workspaceContextMenuActions.openSettings(workspaceId);
  }

  function handleOpenVersionControlFromManager(workspaceId: ContextId): void {
    workspaceContextMenuActions.openVersionControl(workspaceId);
  }

  function handleToggleConsole(): void {
    if (!canOpenLogsPanel) {
      return;
    }
    layoutHandlers.toggleConsole();
  }

  const canFitMarkdownSplit = $derived(layoutHandlers.canFitMarkdownSplit());

  // Re-derive view-tab flags here so the editor prop block reads off local
  // const references (was inline in +page.svelte:544-548).
  const activeViewTabKind = $derived(activeViewKindInActivePane(session));
  const isSettingsViewActive = $derived(activeViewTabKind === "settings");
  const isThemesViewActive = $derived(activeViewTabKind === "themes");
  const isViewTabActive = $derived(activeViewTabKind !== null);

  // The workspace-context-menu open state is owned by OverlayHost; the
  // action callbacks (move / close / openSettings) are page-owned via
  // `workspaceContextMenuActions`. `menuIndex()` reflects the menu's
  // position in the workspaces list.
  const workspaceContextMenuMenu = $derived(overlayHost?.workspaceContextMenu ?? null);

  // Guarded overlay-host accessors: the host is null only on the very first
  // render before `bind:this` fires. The fallbacks render closed overlays.
  const psPanel = $derived(overlayHost?.projectSearchPanelState ?? IDLE_PROJECT_SEARCH);
  const ps = {
    setQuery: (v: string) => overlayHost?.setProjectSearchQuery(v),
    setReplace: (v: string) => overlayHost?.setProjectSearchReplace(v),
    setCaseSensitive: (v: boolean) => overlayHost?.setProjectSearchCaseSensitive(v),
    setWholeWord: (v: boolean) => overlayHost?.setProjectSearchWholeWord(v),
    setRegex: (v: boolean) => overlayHost?.setProjectSearchRegex(v),
    setHeight: (v: number) => overlayHost?.setProjectSearchHeight(v),
    close: () => overlayHost?.api.closeOverlay("projectSearch"),
    run: () => overlayHost?.runProjectSearch(),
    replaceAll: () => overlayHost?.replaceAllInProject(),
    openResult: (path: string, line: number) =>
      overlayHost?.openProjectSearchResult(path, line),
    persistHeight: () => overlayHost?.persistProjectSearchHeight(),
  };

  function handleProjectSearchHeightCommit(): void {
    ps.persistHeight();
  }

  function handleProjectSearchHeightChange(heightPx: number): void {
    ps.setHeight(heightPx);
  }

  function handleProjectSearchClose(): void {
    ps.close();
  }

  function handleProjectSearchQueryChange(value: string): void {
    ps.setQuery(value);
  }

  function handleProjectSearchReplaceChange(value: string): void {
    ps.setReplace(value);
  }

  function handleProjectSearchCaseSensitiveChange(value: boolean): void {
    ps.setCaseSensitive(value);
  }

  function handleProjectSearchWholeWordChange(value: boolean): void {
    ps.setWholeWord(value);
  }

  function handleProjectSearchRegexChange(value: boolean): void {
    ps.setRegex(value);
  }

  function handleProjectSearchRun(): void {
    void ps.run();
  }

  function handleProjectSearchReplaceAll(): void {
    void ps.replaceAll();
  }

  function handleProjectSearchOpenResult(path: string, line: number): void {
    void ps.openResult(path, line);
  }

  function handleRequestCloseWorkspace(workspaceId: ContextId, x: number, y: number): void {
    workspaceContextMenuActions.open(workspaceId, x, y);
  }

  function handleReorderWorkspaces(fromIndex: number, toIndex: number): void {
    appState.reorderWorkspaces(fromIndex, toIndex);
  }

  function handleProjectTreeGetPaneElements(): ReturnType<typeof collectPaneElementsFromDom> {
    return collectPaneElementsFromDom();
  }

  function handleProjectTreeFileDropPaneChange(paneId: string | null): void {
    onFileDropPaneChange(paneId);
  }

  function handleOpenAddMultipleWorkspaces(): void {
    overlayHost?.api.openOverlay("addMultiple");
  }

  function handleMoveTabBetweenPanes(
    fromPaneId: string,
    tabId: string,
    toPaneId: string,
    toIndex: number,
  ): void {
    appState.moveTabBetweenPanes(fromPaneId, tabId, toPaneId, toIndex);
  }

  function handleOpenFileInPane(filePath: string, paneId: string): void {
    void projectTreeHandlers.handleOpenProjectTreeFileInPane(filePath, paneId);
  }

  function handleEditorFileDropPaneChange(paneId: string | null): void {
    onFileDropPaneChange(paneId);
  }

  function handleWorkspaceContextMenuMoveUp(): void {
    workspaceContextMenuActions.move("up");
  }

  function handleWorkspaceContextMenuMoveDown(): void {
    workspaceContextMenuActions.move("down");
  }

  function handleRestartRuntime(): void {
    void agentHandlers.handleRestartAgentHost();
  }
</script>

<AppShell
  bind:shellMainRowEl
  bind:editorShellEl
  bind:editorPaneEl
  bind:workspaceContextMenuEl
  bind:consoleHeightPx
  {consoleOpen}
  onConsoleHeightCommit={layoutHandlers.persistConsoleHeightNow}
  projectSearch={{
    open: psPanel.open,
    heightPx: psPanel.heightPx,
    focusNonce: psPanel.focusNonce,
    focusReplace: psPanel.focusReplace,
    query: psPanel.query,
    replaceValue: psPanel.replaceValue,
    caseSensitive: psPanel.caseSensitive,
    wholeWord: psPanel.wholeWord,
    regex: psPanel.regex,
    queryError: psPanel.queryError,
    results: psPanel.results,
    running: psPanel.running,
    status: psPanel.status,
    onHeightCommit: handleProjectSearchHeightCommit,
    onHeightChange: handleProjectSearchHeightChange,
    onClose: handleProjectSearchClose,
    onQueryChange: handleProjectSearchQueryChange,
    onReplaceValueChange: handleProjectSearchReplaceChange,
    onCaseSensitiveChange: handleProjectSearchCaseSensitiveChange,
    onWholeWordChange: handleProjectSearchWholeWordChange,
    onRegexChange: handleProjectSearchRegexChange,
    onRunSearch: handleProjectSearchRun,
    onReplaceAll: handleProjectSearchReplaceAll,
    onOpenResult: handleProjectSearchOpenResult,
  }}
  activityRail={{
    show: true,
    workspaces: railWorkspaces,
    activeContextId,
    opencodeEnabled,
    panelWidthPx: normalizeActivityRailWidthPx(activityRailWidthPx),
    notepadOpenTabCount,
    notepadRecentTabs,
    contextMenuWorkspaceId: workspaceContextMenuMenu?.workspaceId ?? null,
    onSelectContext: handleSelectContext,
    onAddWorkspace: handleAddWorkspace,
    onOpenWorkspaceManager: handleOpenWorkspaceManager,
    onPanelWidthChange: layoutHandlers.handleActivityRailWidthChange,
    onRequestCloseWorkspace: handleRequestCloseWorkspace,
    onReorderWorkspaces: handleReorderWorkspaces,
    onSelectNotepadTab: handleSelectNotepadTab,
  }}
  sessionsSidebar={{
    show: Boolean(activeWorkspaceRoot) && opencodeEnabled,
    sessions: workspaceSessions,
    activeSessionId: selectedSessionId,
    sidebarTitle: "Sessions",
    collapsed: !showSessionsSidebar,
    panelWidthPx: workspaceLayout.sessionsSidebarWidthPx,
    onToggleCollapsed: layoutHandlers.toggleSessionsSidebarCollapsed,
    onPanelWidthChange: layoutHandlers.handleSessionsSidebarWidthChange,
    onSelectSession: agentHandlers.handleSelectSession,
    onNewSession: agentHandlers.handleNewSession,
    onDeleteSession: agentHandlers.handleDeleteSession,
    onRenameSession: agentHandlers.handleRenameSession,
  }}
  projectTree={{
    workspaceRoot: activeWorkspaceRoot,
    state: projectTreeControllerState,
    activeFilePath: documentView.activeDocumentPath,
    statusByPath: fileStatusByPath,
    collapsed: !showProjectPanel,
    panelWidthPx: workspaceLayout.projectPanelWidthPx,
    onRefresh: projectTreeHandlers.refreshProjectTree,
    onToggleHidden: projectTreeHandlers.toggleProjectTreeHidden,
    onToggleCollapsed: layoutHandlers.toggleProjectPanelCollapsed,
    onPanelWidthChange: layoutHandlers.handleProjectPanelWidthChange,
    onToggleDirectory: projectTreeHandlers.handleToggleProjectTreeDirectory,
    onOpenFile: projectTreeHandlers.handleOpenProjectTreeFile,
    onMoveEntry: projectTreeHandlers.handleMoveProjectTreeEntry,
    onNewFile: projectTreeHandlers.handleNewProjectFile,
    onNewFolder: projectTreeHandlers.handleNewProjectFolder,
    onRenameEntry: projectTreeHandlers.handleRenameProjectEntry,
    onDeleteEntry: projectTreeHandlers.handleDeleteProjectEntry,
    getPaneElements: handleProjectTreeGetPaneElements,
    onOpenFileInPane: projectTreeHandlers.handleOpenProjectTreeFileInPane,
    onFileDropPaneChange: handleProjectTreeFileDropPaneChange,
    notify,
  }}
  editor={{
    contexts,
    contextId: activeContextId,
    session,
    documents,
    activeDocument,
    workspaceRootPath: activeWorkspaceRoot,
    workspaceManager: {
      workspaces,
      activeContextId,
      hiddenRootPaths: workspaceHiddenRootPaths,
      onAddWorkspace: handleAddWorkspace,
      onAddMultiple: handleOpenAddMultipleWorkspaces,
      onSelectWorkspace: handleSelectContext,
      onOpenWorkspaceSettings: handleOpenWorkspaceSettingsFromManager,
      onOpenVersionControl: handleOpenVersionControlFromManager,
    },
    isSessionTabActive,
    isSettingsViewActive,
    isThemesViewActive,
    isViewTabActive,
    isImageDocument: documentView.isImageDocument,
    isBinaryDocument: documentView.isBinaryDocument,
    isLargePendingDocument: documentView.isLargePendingDocument,
    isTextEditorDocument: documentView.isTextEditorDocument,
    isMarkdownDocument: documentView.isMarkdownDocument,
    previewFileSizeBytes: documentView.previewFileSizeBytes,
    previewMode: editorPreviewMode,
    wrapLines: editorWrapLines,
    zoomPercent: editorZoomPercent,
    decoratePlaintextSymbols,
    showMinimap,
    showFoldGutter,
    autoClosePairs,
    autoSuggest,
    maxBinaryOpenAsTextBytes,
    maxOpenWithoutConfirmBytes,
    canFitMarkdownSplit,
    currentWindowId,
    onCloseTab: agentHandlers.handleCloseTab,
    onSelectTab: appState.selectTab,
    onClosePane: appState.closeEditorPane,
    onFocusPane: appState.setActiveEditorPane,
    onMoveTabBetweenPanes: handleMoveTabBetweenPanes,
    onOpenFileInPane: handleOpenFileInPane,
    fileDropTargetPaneId,
    onFileDropPaneChange: handleEditorFileDropPaneChange,
    onRunCommand: commandHandlers.runCommand,
    onConfirmLargeFile: editorHandlers.handleConfirmLargeFile,
    onMarkdownViewModeChange: layoutHandlers.setMarkdownViewMode,
    onUntitledTitleRefresh: editorHandlers.scheduleUntitledTitleRefresh,
    onScrollTopChange: editorHandlers.handleDocumentScrollTop,
    onDeleteSessionFromChat: agentHandlers.handleDeleteSessionFromChat,
    onGoToLine: editorHandlers.runGoToLine,
    notify,
    onRestartRuntime: handleRestartRuntime,
  }}
  statusBar={{
    statusPath: documentView.statusPath,
    statusMessage,
    consoleOpen,
    canOpenLogsPanel,
    cursorLine: editorCursorLine,
    cursorColumn: editorCursorColumn,
    selectionCount: editorSelectionCount,
    onToggleConsole: handleToggleConsole,
  }}
  workspaceContextMenu={{
    menu: workspaceContextMenuMenu,
    menuIndex: workspaceContextMenuActions.menuIndex(),
    workspaceCount: workspaces.length,
    onMoveUp: handleWorkspaceContextMenuMoveUp,
    onMoveDown: handleWorkspaceContextMenuMoveDown,
    onOpenSettings: workspaceContextMenuActions.openSettings,
    onOpenVersionControl: workspaceContextMenuActions.openVersionControl,
    onCloseWorkspace: workspaceContextMenuActions.closeWorkspace,
  }}
  overlays={{
    notify,
    onOpenTimeline: undefined,
  }}
  timelineDialog={undefined}
  quickOpen={undefined}
  commandPalette={undefined}
  headingJump={undefined}
  bookmarkList={undefined}
  snippetInsert={undefined}
  sessionListPanel={undefined}
  addMultipleWorkspaces={undefined}
/>
