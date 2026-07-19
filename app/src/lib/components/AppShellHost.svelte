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
  import type { OverlayHostApi } from "./overlays/overlayHostTypes";
  import { collectPaneElementsFromDom } from "./paneDropTargets";
  import { activeViewKindInActivePane } from "./editorRouting";
  import { appState } from "../state/appState";
  import { chatStore } from "../state/chatStore";
  import type {
    AppDomainState,
    ChatMessage,
    ContextId,
    DocumentState,
    SessionIndexEntry,
    SessionState,
    WorkspaceEntry,
  } from "../domain/contracts";
  import type { ProjectTreeControllerState } from "../services/projectTreeController";
  import type { AppShellDocumentView } from "../services/appShellDocumentView";
  import type { WorkspaceLayoutState } from "../domain/contracts";
  import type { EditorWorkbenchRuntime } from "../editor/editorWorkbenchRuntime";
  import type { EditorToolController } from "../editor/editorToolController";
  import type { WorkspaceFileCatalog } from "../services/workspaceFileCatalog";
  import type { WorkspaceFileCatalogRegistry } from "../services/workspaceFileCatalogRegistry";
  import type { WorkspaceFileCatalogSnapshot } from "../services/workspaceFileCatalog";
  import type { PaletteCommandEntry } from "../commands/catalog";
  import type { ResolvedMarkdownSnippet } from "../domain/snippets";
  import type { createAppShellAgentHandlers } from "../services/appShellAgentHandlers";
  import type {
    createAppShellEditorHandlers,
    createAppShellFileHandlers,
    createAppShellCommandHandlers,
  } from "../services/appShellPageHandlers";
  import type { createAppShellLayoutHandlers } from "../services/appShellLayoutHandlers";
  import type { createAppShellProjectTreeHandlers } from "../services/appShellProjectTreeHandlers";
  import type { createWorkspaceContextMenuActions } from "../services/workspaceContextMenuController";
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

  /**
   * Resolves a workspace-relative path (e.g. from an OpenCode diff payload)
   * to an absolute path. Passes absolute paths through unchanged so callers
   * can mix both shapes safely. (Was inline in +page.svelte; lives here now
   * that the diff-panel "open file" action is wired through AppShellHost.)
   */
  function resolveWorkspaceRelativePath(
    workspaceRoot: string | null,
    relativePath: string,
  ): string {
    const trimmed = relativePath.trim();
    if (!workspaceRoot || trimmed.length === 0) {
      return trimmed;
    }
    if (trimmed.startsWith("/")) {
      return trimmed;
    }
    const root = workspaceRoot.replace(/\/+$/, "");
    return `${root}/${trimmed}`;
  }

  type AgentHandlers = ReturnType<typeof createAppShellAgentHandlers>;
  type EditorHandlers = ReturnType<typeof createAppShellEditorHandlers>;
  type FileHandlers = ReturnType<typeof createAppShellFileHandlers>;
  type LayoutHandlers = ReturnType<typeof createAppShellLayoutHandlers>;
  type ProjectTreeHandlers = ReturnType<typeof createAppShellProjectTreeHandlers>;
  type CommandHandlers = ReturnType<typeof createAppShellCommandHandlers>;
  type WorkspaceContextMenuActions = ReturnType<typeof createWorkspaceContextMenuActions>;

  // Re-export so +page.svelte can `import type { OverlayHostBound }`.
  export type { OverlayHostBound } from "./overlays/overlayHostTypes";
  // (Local alias for brevity in the Props interface below.)
  type OverlayHostBound = import("./overlays/overlayHostTypes").OverlayHostBound;

  interface Props {
    // --- DOM refs (bindable upward to the page) ---
    shellMainRowEl: HTMLDivElement | null;
    editorShellEl: HTMLElement | null;
    editorPaneEl: HTMLElement | null;
    workspaceContextMenuEl: HTMLDivElement | null;
    consoleHeightPx: number;
    consoleOpen: boolean;

    // --- Snapshot-derived values ---
    snapshot: AppDomainState;
    activeContextId: ContextId;
    session: SessionState;
    documents: DocumentState[];
    activeDocument: DocumentState | undefined;
    activeMessages: readonly ChatMessage[];
    activeOpencodeSessionId: string | null;
    activeShareUrl: string | null;
    activeParentSessionId: string | null;
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
    chatHttpRailVisible: boolean;
    isSessionTabActive: boolean;
    isChatHttpActive: boolean;
    currentWindowId: string;
    notepadOpenTabCount: number;
    notepadRecentTabs: { tabId: string; label: string }[];
    fileDropTargetPaneId: string | null;
    statusMessage: string;
    openSessionIds: ReadonlySet<string>;

    // --- Settings-derived flags ---
    opencodeEnabled: boolean;
    canOpenLogsPanel: boolean;
    canFitMarkdownSplit: boolean;

    // --- Todo / diff panels (page-owned booleans + toggle callbacks) ---
    todoPanelOpen: boolean;
    diffPanelOpen: boolean;
    onToggleTodoPanel: () => void;
    onToggleDiffPanel: () => void;

    // --- fileDropTargetPaneId setter (page-owned state) ---
    onFileDropPaneChange: (paneId: string | null) => void;

    // --- Handler bundles ---
    agentHandlers: AgentHandlers;
    editorHandlers: EditorHandlers;
    fileHandlers: FileHandlers;
    layoutHandlers: LayoutHandlers;
    projectTreeHandlers: ProjectTreeHandlers;
    commandHandlers: CommandHandlers;
    workspaceContextMenuActions: WorkspaceContextMenuActions;

    // --- Editor + catalog singletons ---
    editorWorkbench: EditorWorkbenchRuntime;
    editorTools: EditorToolController;
    workspaceFileCatalog: WorkspaceFileCatalog;
    workspaceFileCatalogRegistry: WorkspaceFileCatalogRegistry;

    // --- Overlay host (page-mounted; this wrapper reads its exposed state) ---
    // May be null on the very first render before OverlayHost's `bind:this`
    // fires; the wrapper guards all reads.
    overlayHost: OverlayHostBound | null;

    // --- Misc page-owned helpers ---
    notify: (message: string) => void;
    handleSelectNotepadTab: (tabId: string) => void;
    handleAddWorkspace: () => void;
    handleOpenWorkspaceManager: () => void;
    handleSelectContext: (contextId: ContextId) => void;
    handleOpenWorkspaceSettingsFromManager: (workspaceId: ContextId) => void;
    handleOpenVersionControlFromManager: (workspaceId: ContextId) => void;
    handleToggleConsole: () => void;

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
    consoleOpen,
    snapshot,
    activeContextId,
    session,
    documents,
    activeDocument,
    activeMessages,
    activeOpencodeSessionId,
    activeShareUrl,
    activeParentSessionId,
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
    chatHttpRailVisible,
    isSessionTabActive,
    isChatHttpActive,
    currentWindowId,
    notepadOpenTabCount,
    notepadRecentTabs,
    fileDropTargetPaneId,
    statusMessage,
    openSessionIds,
    opencodeEnabled,
    canOpenLogsPanel,
    canFitMarkdownSplit,
    todoPanelOpen,
    diffPanelOpen,
    onToggleTodoPanel,
    onToggleDiffPanel,
    onFileDropPaneChange,
    agentHandlers,
    editorHandlers,
    fileHandlers,
    layoutHandlers,
    projectTreeHandlers,
    commandHandlers,
    workspaceContextMenuActions,
    editorWorkbench,
    editorTools,
    workspaceFileCatalog,
    workspaceFileCatalogRegistry,
    overlayHost,
    notify,
    handleSelectNotepadTab,
    handleAddWorkspace,
    handleOpenWorkspaceManager,
    handleSelectContext,
    handleOpenWorkspaceSettingsFromManager,
    handleOpenVersionControlFromManager,
    handleToggleConsole,
    quickOpenCatalogSnapshot,
    quickOpenRecencyInputs,
    commandPaletteEntries,
    markdownSnippets,
  }: Props = $props();

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

  // The editor pane element ref is bound upward through AppShell's
  // `onActivePaneElement` callback.
  function handleActivePaneElement(element: HTMLElement): void {
    editorPaneEl = element;
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
    onHeightCommit: () => ps.persistHeight(),
    onHeightChange: (heightPx: number) => ps.setHeight(heightPx),
    onClose: () => ps.close(),
    onQueryChange: (value: string) => ps.setQuery(value),
    onReplaceValueChange: (value: string) => ps.setReplace(value),
    onCaseSensitiveChange: (value: boolean) => ps.setCaseSensitive(value),
    onWholeWordChange: (value: boolean) => ps.setWholeWord(value),
    onRegexChange: (value: boolean) => ps.setRegex(value),
    onRunSearch: () => {
      void ps.run();
    },
    onReplaceAll: () => {
      void ps.replaceAll();
    },
    onOpenResult: (path: string, line: number) => {
      void ps.openResult(path, line);
    },
  }}
  activityRail={{
    show: true,
    workspaces: railWorkspaces,
    activeContextId,
    chatHttpRailVisible,
    panelWidthPx: normalizeActivityRailWidthPx(snapshot.activityRailWidthPx),
    notepadOpenTabCount,
    notepadRecentTabs,
    contextMenuWorkspaceId: workspaceContextMenuMenu?.workspaceId ?? null,
    onSelectContext: handleSelectContext,
    onAddWorkspace: handleAddWorkspace,
    onOpenWorkspaceManager: handleOpenWorkspaceManager,
    onPanelWidthChange: layoutHandlers.handleActivityRailWidthChange,
    onRequestCloseWorkspace: (workspaceId: ContextId, x: number, y: number) =>
      overlayHost?.api.openWorkspaceContextMenu(workspaceId, x, y),
    onReorderWorkspaces: (fromIndex: number, toIndex: number) =>
      appState.reorderWorkspaces(fromIndex, toIndex),
    onSelectNotepadTab: handleSelectNotepadTab,
  }}
  sessionsSidebar={{
    show: (Boolean(activeWorkspaceRoot) && opencodeEnabled) || isChatHttpActive,
    sessions: workspaceSessions,
    activeSessionId: selectedSessionId,
    sidebarTitle: isChatHttpActive ? "Chats" : "Sessions",
    collapsed: !showSessionsSidebar,
    panelWidthPx: workspaceLayout.sessionsSidebarWidthPx,
    onToggleCollapsed: layoutHandlers.toggleSessionsSidebarCollapsed,
    onPanelWidthChange: layoutHandlers.handleSessionsSidebarWidthChange,
    onSelectSession: agentHandlers.handleSelectSession,
    onNewSession: agentHandlers.handleNewSession,
    onDeleteSession: agentHandlers.handleDeleteSession,
    onRenameSession: agentHandlers.handleRenameSession,
    onShareSession: (sessionId: string) => {
      void agentHandlers.handleShareSession(sessionId);
    },
    onExportSession: agentHandlers.handleExportSession,
    onOpenSessions: () => overlayHost?.api.openOverlay("sessionList"),
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
    getPaneElements: () => collectPaneElementsFromDom(),
    onOpenFileInPane: projectTreeHandlers.handleOpenProjectTreeFileInPane,
    onFileDropPaneChange: (paneId: string | null) => onFileDropPaneChange(paneId),
    notify,
  }}
  editor={{
    contextId: activeContextId,
    session,
    documents,
    activeDocument,
    isChatHttpActive,
    workspaceRootPath: activeWorkspaceRoot,
    workspaceManager: {
      workspaces,
      activeContextId,
      hiddenRootPaths: workspaceHiddenRootPaths,
      onAddWorkspace: handleAddWorkspace,
      onAddMultiple: () => overlayHost?.api.openOverlay("addMultiple"),
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
    markdownHtml: documentView.markdownHtml,
    previewMode: snapshot.editor.previewMode,
    wrapLines: snapshot.editor.wrapLines,
    zoomPercent: snapshot.editor.zoomPercent,
    cursorLine: snapshot.editor.cursorLine,
    cursorColumn: snapshot.editor.cursorColumn,
    selectionCount: snapshot.editor.selectionCount,
    decoratePlaintextSymbols: snapshot.settings.decoratePlaintextSymbols,
    showMinimap: snapshot.settings.showMinimap,
    showFoldGutter: snapshot.settings.showFoldGutter,
    autoClosePairs: snapshot.settings.autoClosePairs,
    autoSuggest: snapshot.settings.autoSuggest,
    maxBinaryOpenAsTextBytes: snapshot.settings.externalFiles.maxBinaryOpenAsTextBytes,
    maxOpenWithoutConfirmBytes: snapshot.settings.externalFiles.maxOpenWithoutConfirmBytes,
    canFitMarkdownSplit,
    currentWindowId,
    onCloseTab: agentHandlers.handleCloseTab,
    onSelectTab: appState.selectTab,
    onClosePane: appState.closeEditorPane,
    onFocusPane: appState.setActiveEditorPane,
    onMoveTabBetweenPanes: (
      fromPaneId: string,
      tabId: string,
      toPaneId: string,
      toIndex: number,
    ) => appState.moveTabBetweenPanes(fromPaneId, tabId, toPaneId, toIndex),
    onOpenFileInPane: (filePath: string, paneId: string) =>
      projectTreeHandlers.handleOpenProjectTreeFileInPane(filePath, paneId),
    fileDropTargetPaneId,
    onFileDropPaneChange: (paneId: string | null) => onFileDropPaneChange(paneId),
    onRunCommand: commandHandlers.runCommand,
    onConfirmLargeFile: editorHandlers.handleConfirmLargeFile,
    onMarkdownViewModeChange: layoutHandlers.setMarkdownViewMode,
    onUntitledTitleRefresh: editorHandlers.scheduleUntitledTitleRefresh,
    onScrollTopChange: editorHandlers.handleDocumentScrollTop,
    onDeleteSessionFromChat: agentHandlers.handleDeleteSessionFromChat,
    onGoToLine: editorHandlers.runGoToLine,
    notify,
    onForkSession: (messageId?: string) => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void agentHandlers.handleForkSession(sessionId, messageId);
      }
    },
    onRevertSession: (messageId?: string) => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void agentHandlers.handleRevertSession(sessionId, messageId);
      }
    },
    onUnrevertSession: () => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void agentHandlers.handleUnrevertSession(sessionId);
      }
    },
    onShareSession: () => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void agentHandlers.handleShareSession(sessionId);
      }
    },
    onUnshareSession: () => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void agentHandlers.handleUnshareSession(sessionId);
      }
    },
    onSummarizeSession: () => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void agentHandlers.handleSummarizeSession(sessionId);
      }
    },
    onExportSession: () => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void agentHandlers.handleExportSession(sessionId);
      }
    },
    activeShareUrl,
    activeParentSessionId,
  }}
  statusBar={{
    statusPath: documentView.statusPath,
    statusMessage,
    consoleOpen,
    canOpenLogsPanel,
    onToggleConsole: handleToggleConsole,
  }}
  workspaceContextMenu={{
    menu: workspaceContextMenuMenu,
    menuIndex: workspaceContextMenuActions.menuIndex(),
    workspaceCount: workspaces.length,
    onMoveUp: () => workspaceContextMenuActions.move("up"),
    onMoveDown: () => workspaceContextMenuActions.move("down"),
    onOpenSettings: workspaceContextMenuActions.openSettings,
    onOpenVersionControl: workspaceContextMenuActions.openVersionControl,
    onCloseWorkspace: workspaceContextMenuActions.closeWorkspace,
  }}
  overlays={{
    notify,
  }}
  todoPanel={{
    open: todoPanelOpen && Boolean(activeWorkspaceRoot) && Boolean(activeOpencodeSessionId),
    workspaceRootPath: activeWorkspaceRoot,
    sessionId: activeOpencodeSessionId,
    onToggle: onToggleTodoPanel,
  }}
  diffPanel={{
    open: diffPanelOpen && Boolean(activeWorkspaceRoot) && Boolean(activeOpencodeSessionId),
    workspaceRootPath: activeWorkspaceRoot,
    sessionId: activeOpencodeSessionId,
    onToggle: onToggleDiffPanel,
    onOpenFile: (filePath: string) => {
      // OpenCode diff paths are workspace-relative; resolve to an absolute
      // path before opening (matches the project-tree path convention).
      const resolved = resolveWorkspaceRelativePath(activeWorkspaceRoot, filePath);
      void projectTreeHandlers.handleOpenProjectTreeFile(resolved);
    },
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
