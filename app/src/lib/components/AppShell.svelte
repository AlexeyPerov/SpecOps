<script lang="ts">
  import ConsolePanel from "./ConsolePanel.svelte";
  import EntryNamePrompt from "./EntryNamePrompt.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import TagPushPrompt from "./TagPushPrompt.svelte";
  import AskpassPrompt from "./AskpassPrompt.svelte";
  import TagDeletePrompt from "./TagDeletePrompt.svelte";
  import LocalChangesCheckoutPrompt from "./LocalChangesCheckoutPrompt.svelte";
  import LocalChangesPullPrompt from "./LocalChangesPullPrompt.svelte";
  import LocalChangesStashApplyPrompt from "./LocalChangesStashApplyPrompt.svelte";
  import StashDropPrompt from "./StashDropPrompt.svelte";
  import PreGitAutosavePrompt from "./PreGitAutosavePrompt.svelte";
  import RevertPreviewDialog from "./RevertPreviewDialog.svelte";
  import SessionListPanel from "./SessionListPanel.svelte";
  import AddMultipleWorkspacesModal from "./AddMultipleWorkspacesModal.svelte";
  import PermissionPrompt from "./PermissionPrompt.svelte";
  import QuestionPrompt from "./QuestionPrompt.svelte";
  import TabBar from "./TabBar.svelte";
  import EditorGridLayout from "./EditorGridLayout.svelte";
  import EditorPaneContent from "./EditorPaneContent.svelte";
  import ActivityRail from "./ActivityRail.svelte";
  import ProjectPanel from "./ProjectPanel.svelte";
  import SessionsSidebar from "./SessionsSidebar.svelte";
  import ChatPanel from "./ChatPanel.svelte";
  import TodoPanel from "./TodoPanel.svelte";
  import DiffViewerPanel from "./DiffViewerPanel.svelte";
  import ProjectSearchPanel from "./ProjectSearchPanel.svelte";
  import SessionTimelineDialog from "./SessionTimelineDialog.svelte";
  import QuickOpenPicker from "./QuickOpenPicker.svelte";
  import CommandPalettePicker from "./CommandPalettePicker.svelte";
  import HeadingJumpPicker from "./HeadingJumpPicker.svelte";
  import BookmarkListPicker from "./BookmarkListPicker.svelte";
  import SnippetInsertPicker from "./SnippetInsertPicker.svelte";
  import type { ProjectTreeControllerState } from "../services/projectTreeController";
  import type { ProjectTreeNode } from "../services/projectTree";
  import TitleBar from "./TitleBar.svelte";
  import type {
    SessionIndexEntry,
    AppCommandId,
    ContextId,
    DocumentState,
    SessionState,
    TabState,
    WorkspaceEntry,
  } from "../domain/contracts";
  import { appState } from "../state/appState";
  import "../styles/app-shell.css";

  export interface AppShellActivityRailProps {
    show: boolean;
    workspaces: WorkspaceEntry[];
    activeContextId: ContextId;
    chatHttpRailVisible: boolean;
    panelWidthPx: number;
    notepadOpenTabCount: number;
    notepadRecentTabs: { tabId: string; label: string }[];
    /** When non-null, a workspace context menu is open — suppress tooltips. */
    contextMenuWorkspaceId?: ContextId | null;
    onSelectContext: (contextId: ContextId) => void;
    onAddWorkspace: () => void;
    onOpenWorkspaceManager: () => void;
    onPanelWidthChange: (width: number) => void;
    onRequestCloseWorkspace: (workspaceId: ContextId, x: number, y: number) => void;
    onReorderWorkspaces: (fromIndex: number, toIndex: number) => void;
    onSelectNotepadTab: (tabId: string) => void;
  }

  export interface AppShellSessionsSidebarProps {
    show: boolean;
    sessions: SessionIndexEntry[];
    activeSessionId: string | null;
    sidebarTitle: string;
    collapsed: boolean;
    panelWidthPx: number;
    onToggleCollapsed: (next: boolean) => void;
    onPanelWidthChange: (widthPx: number) => void;
    onSelectSession: (sessionId: string) => void;
    onNewSession: () => void;
    onDeleteSession: (sessionId: string) => void | Promise<void>;
    /** M2-T1: rename the agent tab + linked session. */
    onRenameSession?: (sessionId: string) => void | Promise<void>;
    /** M2-T5: copy a public share URL for the linked session. */
    onShareSession?: (sessionId: string) => void | Promise<void>;
    /** M2-T7: export the transcript to a Markdown file. */
    onExportSession?: (sessionId: string) => void | Promise<void>;
    /** M2-T2: open the unified per-workspace session list panel. */
    onOpenSessions?: () => void | Promise<void>;
  }

  export interface AppShellProjectTreeProps {
    workspaceRoot: string | null;
    state: ProjectTreeControllerState;
    activeFilePath: string | null;
    /** M5-T3 — git change status badges (absolute path → status). */
    statusByPath?: ReadonlyMap<
      string,
      import("../ai/backends/workspaceAgentBackend").OpencodeFileChangeStatus
    > | null;
    collapsed: boolean;
    panelWidthPx: number;
    onRefresh: () => void | Promise<void>;
    onToggleHidden: (next: boolean) => void | Promise<void>;
    onToggleCollapsed: (next: boolean) => void;
    onPanelWidthChange: (widthPx: number) => void;
    onToggleDirectory: (path: string) => void | Promise<void>;
    onOpenFile: (path: string) => void | Promise<void>;
    onMoveEntry: (sourcePath: string, destDirPath: string) => Promise<void>;
    onNewFile: (parentDirPath: string) => void | Promise<void>;
    onNewFolder: (parentDirPath: string) => void | Promise<void>;
    onRenameEntry: (path: string, kind: ProjectTreeNode["kind"]) => void | Promise<void>;
    onDeleteEntry: (path: string, kind: ProjectTreeNode["kind"]) => void | Promise<void>;
    /** Phase 6 — live editor pane elements for file→pane DnD hit-testing. */
    getPaneElements?: () => import("./paneDropTargets").PaneDropTargetElements[];
    /** Phase 6 — open a file into a specific pane (file drag drop). */
    onOpenFileInPane?: (filePath: string, paneId: string) => void | Promise<void>;
    /** Phase 6 — reports the hovered pane during a file drag (for affordance). */
    onFileDropPaneChange?: (paneId: string | null) => void;
    notify: (message: string) => void;
  }

  /**
   * Workspace-manager view-tab wiring. The list source is the same
   * `contexts.workspaces` the activity rail uses (decision 1); the callbacks
   * drive row actions (switch / settings) and the add / add-multiple buttons.
   */
  export interface AppShellWorkspaceManagerProps {
    workspaces: WorkspaceEntry[];
    activeContextId: ContextId;
    /** Normalized root paths hidden from the activity rail. */
    hiddenRootPaths: Set<string>;
    onAddWorkspace: () => void;
    onAddMultiple: () => void;
    onSelectWorkspace: (workspaceId: ContextId) => void;
    onOpenWorkspaceSettings: (workspaceId: ContextId) => void;
    onOpenVersionControl: (workspaceId: ContextId) => void;
  }

  export interface AppShellEditorChromeProps {
    session: SessionState;
    documents: DocumentState[];
    activeDocument: DocumentState | undefined;
    isChatHttpActive: boolean;
    /** Active workspace root path, scoped to the workspace-settings view. */
    workspaceRootPath?: string | null;
    /** Workspace-manager view-tab wiring (list source, callbacks). */
    workspaceManager?: AppShellWorkspaceManagerProps;
    isSessionTabActive: boolean;
    isSettingsViewActive: boolean;
    isThemesViewActive: boolean;
    isViewTabActive: boolean;
    isImageDocument: boolean;
    isBinaryDocument: boolean;
    isLargePendingDocument: boolean;
    isTextEditorDocument: boolean;
    isMarkdownDocument: boolean;
    previewFileSizeBytes: number;
    markdownHtml: string;
    previewMode: "editor" | "markdown" | "diff";
    wrapLines: boolean;
    zoomPercent: number;
    cursorLine: number;
    cursorColumn: number;
    selectionCount: number;
    decoratePlaintextSymbols: boolean;
    showMinimap: boolean;
    showFoldGutter: boolean;
    autoClosePairs: boolean;
    autoSuggest: boolean;
    maxBinaryOpenAsTextBytes: number;
    maxOpenWithoutConfirmBytes: number;
    canFitMarkdownSplit: boolean;
    currentWindowId: string;
    onCloseTab: (paneId: string, tabId: string) => void | Promise<void>;
    onRunCommand: (commandId: AppCommandId) => void;
    onConfirmLargeFile: (documentId: string) => void | Promise<void>;
    onMarkdownViewModeChange: (nextMode: "edit" | "split" | "preview") => void;
    onUntitledTitleRefresh: (documentId: string) => void;
    onScrollTopChange: (documentId: string, scrollTop: number) => void;
    onDeleteSessionFromChat: () => void | Promise<void>;
    onGoToLine: () => void;
    notify: (message: string) => void;
    onSelectTab: (tabId: string) => void;
    onClosePane: (paneId: string) => void;
    onFocusPane: (paneId: string) => void;
    onMoveTabBetweenPanes: (
      fromPaneId: string,
      tabId: string,
      toPaneId: string,
      toIndex: number,
    ) => void;
    onOpenFileInPane: (filePath: string, paneId: string) => void | Promise<void>;
    fileDropTargetPaneId?: string | null;
    onFileDropPaneChange?: (paneId: string | null) => void;
    /** M2-T3: fork the active session from a message into a new tab. */
    onForkSession?: (messageId?: string) => void | Promise<void>;
    /** M2-T4: revert the active session to a message in place (undo). */
    onRevertSession?: (messageId?: string) => void | Promise<void>;
    /** M2-T4: restore a reverted session in place (redo). */
    onUnrevertSession?: () => void | Promise<void>;
    /** M2-T5: share / unshare the active session. */
    onShareSession?: () => void | Promise<void>;
    onUnshareSession?: () => void | Promise<void>;
    /** M2-T6: generate / refresh the session summary. */
    onSummarizeSession?: () => void | Promise<void>;
    /** M2-T7: export the active transcript to Markdown. */
    onExportSession?: () => void | Promise<void>;
    /** M2-T5: current share URL for the active session, if any. */
    activeShareUrl?: string | null;
    /** M2-T3: parent session id, if the active session is a fork. */
    activeParentSessionId?: string | null;
  }

  export interface AppShellStatusBarProps {
    statusPath: string;
    statusMessage: string;
    consoleOpen: boolean;
    canOpenLogsPanel: boolean;
    onToggleConsole: () => void;
  }

  /** Props driving the Find-in-Project bottom panel (console-style local state). */
  export interface AppShellProjectSearchProps {
    open: boolean;
    heightPx: number;
    focusNonce: number;
    focusReplace: boolean;
    query: string;
    replaceValue: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    regex: boolean;
    /** Inline regex validation error (empty string when the query is valid). */
    queryError: string;
    results: import("../services/projectSearch").ProjectSearchResult[];
    running: boolean;
    status: string;
    onHeightCommit: () => void;
    onHeightChange: (heightPx: number) => void;
    onClose: () => void;
    onQueryChange: (value: string) => void;
    onReplaceValueChange: (value: string) => void;
    onCaseSensitiveChange: (value: boolean) => void;
    onWholeWordChange: (value: boolean) => void;
    onRegexChange: (value: boolean) => void;
    onRunSearch: () => void;
    onReplaceAll: () => void;
    onOpenResult: (path: string, line: number) => void;
  }

  export interface AppShellWorkspaceContextMenuProps {
    menu: { workspaceId: ContextId; x: number; y: number } | null;
    menuIndex: number;
    workspaceCount: number;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onOpenSettings: (workspaceId: ContextId) => void;
    onOpenVersionControl: (workspaceId: ContextId) => void;
    onCloseWorkspace: (workspaceId: ContextId) => void;
  }

  /**
   * M5-T5 — session timeline dialog. `messages` come from the active
   * transcript (already hydrated); `onJumpToMessage` scrolls the transcript.
   */
  export interface AppShellTimelineDialogProps {
    open: boolean;
    messages: readonly import("../domain/contracts").ChatMessage[];
    searchQuery: string;
    onJumpToMessage?: (messageId: string) => void;
    onToggle?: () => void;
    onClose?: () => void;
    onSearchChange?: (query: string) => void;
  }

  export interface AppShellOverlayProps {
    notify: (message: string) => void;
  }

  export interface AppShellSessionListPanelProps {
    open: boolean;
    sessions: readonly import("../ai/backends/workspaceAgentBackend").WorkspaceAgentSessionDetails[];
    openSessionIds: ReadonlySet<string>;
    activeSessionId: string | null;
    loading: boolean;
    errorMessage: string | null;
    sort: import("../ai/backends/opencodeSessionList").SessionListSort;
    searchQuery: string;
    onOpenSession: (sessionId: string, title?: string) => void;
    onClose: () => void;
    onSearchChange: (query: string) => void;
    onSortChange: (sort: import("../ai/backends/opencodeSessionList").SessionListSort) => void;
    onRefresh: () => void;
  }

  /** Add-multiple workspaces modal props (decision 8). */
  export interface AppShellAddMultipleWorkspacesProps {
    open: boolean;
    loading: boolean;
    errorMessage: string | null;
    parentPath: string | null;
    entries: ReadonlyArray<import("../services/workspaceSubfolders").ImmediateSubfolder>;
    selected: Set<string>;
    onToggleEntry: (path: string, checked: boolean) => void;
    onConfirm: () => void;
    onCancel: () => void;
  }

  /**
   * M5-T1 — agent TODO panel. Shown as a right-side rail when a workspace
   * agent tab with a linked OpenCode session is active. `open` toggles it;
   * `workspaceRootPath` + `sessionId` scope the `session.todo` fetch.
   */
  export interface AppShellTodoPanelProps {
    open: boolean;
    workspaceRootPath: string | null;
    sessionId: string | null;
    onToggle?: () => void;
    onJumpToMessage?: () => void;
  }

  /**
   * M5-T2 — agent diff viewer panel. Same scoping rules as the TODO panel;
   * `onOpenFile` lets a row open the file in the editor.
   */
  export interface AppShellDiffPanelProps {
    open: boolean;
    workspaceRootPath: string | null;
    sessionId: string | null;
    onToggle?: () => void;
    onOpenFile?: (filePath: string) => void;
  }

  /**
   * M1.2 — Quick Open file picker props. The picker reuses the shared
   * `SearchablePickerShell` and renders ranked catalog results. `open` gates
   * visibility; `results` carries the ranked matches + catalog metadata;
   * `onSelect` opens a file through the existing gated pipeline.
   */
  export interface AppShellQuickOpenProps {
    open: boolean;
    results: import("../picker/fileRanking").RankedFilesResult;
    onSelect: (path: string) => void;
    onClose: () => void;
    onRefresh?: () => void;
    onQueryInput?: (query: string) => void;
  }

  export interface AppShellCommandPaletteProps {
    open: boolean;
    results: import("../picker/commandRanking").RankedCommandsResult;
    onSelect: (commandId: string) => void;
    onClose: () => void;
    onQueryInput?: (query: string) => void;
  }

  export interface AppShellHeadingJumpProps {
    open: boolean;
    results: import("../picker/headingRanking").RankedHeadingsResult;
    onSelect: (headingKey: string) => void;
    onClose: () => void;
    onQueryInput?: (query: string) => void;
  }

  export interface AppShellBookmarkListProps {
    open: boolean;
    bookmarks: readonly import("../types/editor").EditorBookmarkSnapshot[];
    onSelect: (line: number) => void;
    onClose: () => void;
    onQueryInput?: (query: string) => void;
  }

  export interface AppShellSnippetInsertProps {
    open: boolean;
    results: import("../picker/snippetRanking").RankedSnippetsResult;
    onSelect: (snippetId: string) => void;
    onClose: () => void;
    onQueryInput?: (query: string) => void;
  }

  let {
    activityRail,
    sessionsSidebar,
    projectTree,
    editor,
    statusBar,
    projectSearch,
    workspaceContextMenu,
    overlays,
    sessionListPanel,
    addMultipleWorkspaces,
    todoPanel,
    diffPanel,
    timelineDialog,
    quickOpen,
    commandPalette,
    headingJump,
    bookmarkList,
    snippetInsert,
    onConsoleHeightCommit,
    consoleOpen = false,
    consoleHeightPx = $bindable(0),
    shellMainRowEl = $bindable<HTMLDivElement | null>(null),
    editorShellEl = $bindable<HTMLElement | null>(null),
    editorPaneEl = $bindable<HTMLElement | null>(null),
    workspaceContextMenuEl = $bindable<HTMLDivElement | null>(null),
  }: {
    activityRail: AppShellActivityRailProps;
    sessionsSidebar: AppShellSessionsSidebarProps;
    projectTree: AppShellProjectTreeProps;
    editor: AppShellEditorChromeProps;
    statusBar: AppShellStatusBarProps;
    projectSearch?: AppShellProjectSearchProps;
    workspaceContextMenu: AppShellWorkspaceContextMenuProps;
    overlays: AppShellOverlayProps;
    sessionListPanel?: AppShellSessionListPanelProps;
    addMultipleWorkspaces?: AppShellAddMultipleWorkspacesProps;
    todoPanel?: AppShellTodoPanelProps;
    diffPanel?: AppShellDiffPanelProps;
    timelineDialog?: AppShellTimelineDialogProps;
    quickOpen?: AppShellQuickOpenProps;
    commandPalette?: AppShellCommandPaletteProps;
    headingJump?: AppShellHeadingJumpProps;
    bookmarkList?: AppShellBookmarkListProps;
    snippetInsert?: AppShellSnippetInsertProps;
    onConsoleHeightCommit: () => void;
    consoleOpen?: boolean;
    consoleHeightPx?: number;
    shellMainRowEl?: HTMLDivElement | null;
    editorShellEl?: HTMLElement | null;
    editorPaneEl?: HTMLElement | null;
    workspaceContextMenuEl?: HTMLDivElement | null;
  } = $props();

  const gitIntegrationEnabled = $derived($appState.settings.gitIntegration.enabled);
  const activePaneId = $derived(editor.session.editorLayout.activePaneId);

  // Status-bar overflow (U3.4): when the bar is too narrow, the secondary
  // document/view clusters collapse into a popover listing the hidden values
  // — replacing the old responsive hide-breakpoints that silently dropped info.
  let statusOverflowOpen = $state(false);
  let statusOverflowEl = $state<HTMLDivElement | null>(null);
  let statusOverflowButtonEl = $state<HTMLButtonElement | null>(null);
  let statusBarEl = $state<HTMLElement | null>(null);
  let statusOverflowNeeded = $state(false);

  // Width (px) below which the document/view clusters collapse into the
  // overflow popover. Mirrors the old 760px hide-breakpoint — the narrowest
  // width at which document info was still shown.
  const RO_THRESHOLD_PX = 760;

  $effect(() => {
    const el = statusBarEl;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Overflow is needed when the bar is narrow enough that the document
        // and view clusters would crowd the primary cluster + right side.
        const needed = entry.contentRect.width < RO_THRESHOLD_PX;
        statusOverflowNeeded = needed;
        if (!needed && statusOverflowOpen) {
          closeStatusOverflow();
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  function openStatusOverflow(): void {
    if (statusOverflowOpen) {
      return;
    }
    statusOverflowOpen = true;
    window.addEventListener("pointerdown", onStatusOverflowPointerDown);
    window.addEventListener("keydown", onStatusOverflowKeydown);
  }

  function closeStatusOverflow(): void {
    if (!statusOverflowOpen) {
      return;
    }
    statusOverflowOpen = false;
    window.removeEventListener("pointerdown", onStatusOverflowPointerDown);
    window.removeEventListener("keydown", onStatusOverflowKeydown);
  }

  function toggleStatusOverflow(): void {
    if (statusOverflowOpen) {
      closeStatusOverflow();
    } else {
      openStatusOverflow();
    }
  }

  function onStatusOverflowPointerDown(event: PointerEvent): void {
    if (!statusOverflowOpen) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && statusOverflowEl?.contains(target)) {
      return;
    }
    if (target instanceof Node && statusOverflowButtonEl?.contains(target)) {
      return;
    }
    closeStatusOverflow();
  }

  function onStatusOverflowKeydown(event: KeyboardEvent): void {
    if (statusOverflowOpen && event.key === "Escape") {
      event.preventDefault();
      closeStatusOverflow();
      statusOverflowButtonEl?.focus();
    }
  }
</script>

<main class="shell">
  <TitleBar />
  <div class="shell-main-row" bind:this={shellMainRowEl}>
    {#if activityRail.show}
      <ActivityRail
        workspaces={activityRail.workspaces}
        activeContextId={activityRail.activeContextId}
        showChatHttp={activityRail.chatHttpRailVisible}
        panelWidthPx={activityRail.panelWidthPx}
        notepadOpenTabCount={activityRail.notepadOpenTabCount}
        notepadRecentTabs={activityRail.notepadRecentTabs}
        contextMenuWorkspaceId={activityRail.contextMenuWorkspaceId ?? null}
        onSelectContext={activityRail.onSelectContext}
        onAddWorkspace={activityRail.onAddWorkspace}
        onOpenWorkspaceManager={activityRail.onOpenWorkspaceManager}
        onPanelWidthChange={activityRail.onPanelWidthChange}
        onRequestCloseWorkspace={activityRail.onRequestCloseWorkspace}
        onReorderWorkspaces={activityRail.onReorderWorkspaces}
        onSelectNotepadTab={activityRail.onSelectNotepadTab}
      />
    {/if}
    {#if sessionsSidebar.show}
      <SessionsSidebar
        sessions={sessionsSidebar.sessions}
        activeSessionId={sessionsSidebar.activeSessionId}
        sidebarTitle={sessionsSidebar.sidebarTitle}
        collapsed={sessionsSidebar.collapsed}
        panelWidthPx={sessionsSidebar.panelWidthPx}
        onToggleCollapsed={sessionsSidebar.onToggleCollapsed}
        onPanelWidthChange={sessionsSidebar.onPanelWidthChange}
        onSelectSession={sessionsSidebar.onSelectSession}
        onNewSession={sessionsSidebar.onNewSession}
        onDeleteSession={(sessionId) => void sessionsSidebar.onDeleteSession(sessionId)}
        onRenameSession={sessionsSidebar.onRenameSession}
        onShareSession={sessionsSidebar.onShareSession}
        onExportSession={sessionsSidebar.onExportSession}
        onOpenSessions={sessionsSidebar.onOpenSessions}
      />
    {/if}
    <section class="editor-shell" bind:this={editorShellEl}>
      <EditorGridLayout
        layout={editor.session.editorLayout}
        documents={editor.documents}
        useChatTerminology={editor.isChatHttpActive}
        windowId={editor.currentWindowId}
        notify={editor.notify}
        onSelectTab={editor.onSelectTab}
        onCloseTab={editor.onCloseTab}
        onClosePane={editor.onClosePane}
        onFocusPane={editor.onFocusPane}
        onMoveTabBetweenPanes={editor.onMoveTabBetweenPanes}
        onOpenFileInPane={editor.onOpenFileInPane}
        fileDropTargetPaneId={editor.fileDropTargetPaneId ?? null}
      >
        {#snippet renderPaneContent(paneId)}
          <EditorPaneContent
            {paneId}
            isActivePane={paneId === activePaneId}
            session={editor.session}
            documents={editor.documents}
            isChatHttpActive={editor.isChatHttpActive}
            workspaceRootPath={editor.workspaceRootPath ?? null}
            workspaceManagerWorkspaces={editor.workspaceManager?.workspaces ?? []}
            workspaceManagerActiveContextId={editor.workspaceManager?.activeContextId ?? "notepad"}
            workspaceManagerHiddenRootPaths={editor.workspaceManager?.hiddenRootPaths ?? new Set()}
            onWorkspaceManagerAddWorkspace={editor.workspaceManager?.onAddWorkspace ?? (() => {})}
            onWorkspaceManagerAddMultiple={editor.workspaceManager?.onAddMultiple ?? (() => {})}
            onWorkspaceManagerSelectWorkspace={editor.workspaceManager?.onSelectWorkspace ?? (() => {})}
            onWorkspaceManagerOpenSettings={editor.workspaceManager?.onOpenWorkspaceSettings ?? (() => {})}
            onWorkspaceManagerOpenVersionControl={editor.workspaceManager?.onOpenVersionControl ?? (() => {})}
            previewMode={editor.previewMode}
            wrapLines={editor.wrapLines}
            zoomPercent={editor.zoomPercent}
            decoratePlaintextSymbols={editor.decoratePlaintextSymbols}
            showMinimap={editor.showMinimap}
            showFoldGutter={editor.showFoldGutter}
            autoClosePairs={editor.autoClosePairs}
            autoSuggest={editor.autoSuggest}
            maxBinaryOpenAsTextBytes={editor.maxBinaryOpenAsTextBytes}
            maxOpenWithoutConfirmBytes={editor.maxOpenWithoutConfirmBytes}
            canFitMarkdownSplit={editor.canFitMarkdownSplit}
            windowId={editor.currentWindowId}
            onActivePaneElement={(element) => {
              editorPaneEl = element;
            }}
            onConfirmLargeFile={editor.onConfirmLargeFile}
            onMarkdownViewModeChange={editor.onMarkdownViewModeChange}
            onUntitledTitleRefresh={editor.onUntitledTitleRefresh}
            onScrollTopChange={editor.onScrollTopChange}
            onDeleteSessionFromChat={editor.onDeleteSessionFromChat}
            onForkSession={editor.onForkSession}
            onRevertSession={editor.onRevertSession}
            onUnrevertSession={editor.onUnrevertSession}
            onShareSession={editor.onShareSession}
            onUnshareSession={editor.onUnshareSession}
            onSummarizeSession={editor.onSummarizeSession}
            onExportSession={editor.onExportSession}
            activeShareUrl={editor.activeShareUrl}
            activeParentSessionId={editor.activeParentSessionId}
            canToggleTodoPanel={Boolean(todoPanel)}
            todoPanelOpen={Boolean(todoPanel?.open)}
            onToggleTodoPanel={() => todoPanel?.onToggle?.()}
            canToggleDiffPanel={Boolean(diffPanel)}
            diffPanelOpen={Boolean(diffPanel?.open)}
            onToggleDiffPanel={() => diffPanel?.onToggle?.()}
            onOpenTimeline={timelineDialog?.onToggle}
            onGoToLine={editor.onGoToLine}
            notify={editor.notify}
          />
        {/snippet}
      </EditorGridLayout>
    </section>
    {#if projectTree.workspaceRoot}
      <ProjectPanel
        workspaceRoot={projectTree.workspaceRoot}
        rootNodes={projectTree.state.rootNodes}
        expandedPaths={projectTree.state.expandedPaths}
        childrenByPath={projectTree.state.childrenByPath}
        loadingPaths={projectTree.state.loadingPaths}
        activeFilePath={projectTree.activeFilePath}
        statusByPath={projectTree.statusByPath ?? null}
        showHidden={projectTree.state.showHidden}
        collapsed={projectTree.collapsed}
        panelWidthPx={projectTree.panelWidthPx}
        onRefresh={projectTree.onRefresh}
        onToggleHidden={projectTree.onToggleHidden}
        onToggleCollapsed={projectTree.onToggleCollapsed}
        onPanelWidthChange={projectTree.onPanelWidthChange}
        onToggleDirectory={projectTree.onToggleDirectory}
        onOpenFile={projectTree.onOpenFile}
        onMoveEntry={(sourcePath, destDirPath) => projectTree.onMoveEntry(sourcePath, destDirPath)}
        onNewFile={(parent) => void projectTree.onNewFile(parent)}
        onNewFolder={(parent) => void projectTree.onNewFolder(parent)}
        onRenameEntry={(path, kind) => void projectTree.onRenameEntry(path, kind)}
        onDeleteEntry={(path, kind) => void projectTree.onDeleteEntry(path, kind)}
        getPaneElements={projectTree.getPaneElements ?? (() => [])}
        onOpenFileInPane={projectTree.onOpenFileInPane ?? null}
        onFileDropPaneChange={(paneId) => projectTree.onFileDropPaneChange?.(paneId)}
        notify={projectTree.notify}
      />
    {/if}
    {#if diffPanel?.open && diffPanel.workspaceRootPath && diffPanel.sessionId}
      <DiffViewerPanel
        workspaceRootPath={diffPanel.workspaceRootPath}
        sessionId={diffPanel.sessionId}
        onOpenFile={diffPanel.onOpenFile}
      />
    {/if}
    {#if todoPanel?.open && todoPanel.workspaceRootPath && todoPanel.sessionId}
      <TodoPanel
        workspaceRootPath={todoPanel.workspaceRootPath}
        sessionId={todoPanel.sessionId}
        onJumpToMessage={todoPanel.onJumpToMessage}
      />
    {/if}
  </div>

  <div class="bottom-panel">
    {#if projectSearch?.open}
      <ProjectSearchPanel
        heightPx={projectSearch.heightPx}
        onHeightCommit={projectSearch.onHeightCommit}
        onHeightChange={projectSearch.onHeightChange}
        onClose={projectSearch.onClose}
        query={projectSearch.query}
        replaceValue={projectSearch.replaceValue}
        caseSensitive={projectSearch.caseSensitive}
        wholeWord={projectSearch.wholeWord}
        regex={projectSearch.regex}
        queryError={projectSearch.queryError}
        results={projectSearch.results}
        running={projectSearch.running}
        status={projectSearch.status}
        focusNonce={projectSearch.focusNonce}
        focusReplace={projectSearch.focusReplace}
        onQueryChange={projectSearch.onQueryChange}
        onReplaceValueChange={projectSearch.onReplaceValueChange}
        onCaseSensitiveChange={projectSearch.onCaseSensitiveChange}
        onWholeWordChange={projectSearch.onWholeWordChange}
        onRegexChange={projectSearch.onRegexChange}
        onRunSearch={projectSearch.onRunSearch}
        onReplaceAll={projectSearch.onReplaceAll}
        onOpenResult={projectSearch.onOpenResult}
      />
    {/if}
    {#if consoleOpen}
      <ConsolePanel bind:heightPx={consoleHeightPx} onHeightCommit={onConsoleHeightCommit} />
    {/if}

    <footer
      class="status-bar"
      class:status-bar-console-open={consoleOpen}
      class:status-bar-overflow-open={statusOverflowOpen}
      bind:this={statusBarEl}
    >
      <button
        type="button"
        class="status-bar-button"
        class:status-bar-button-static={!statusBar.canOpenLogsPanel}
        class:status-bar-button-overflow={statusOverflowNeeded && !editor.isSessionTabActive && !editor.isChatHttpActive && !editor.isViewTabActive}
        disabled={!statusBar.canOpenLogsPanel}
        title={statusBar.canOpenLogsPanel
          ? consoleOpen
            ? "Hide console"
            : "Show console"
          : undefined}
        onclick={statusBar.onToggleConsole}
      >
        {#if !editor.isSessionTabActive && !editor.isChatHttpActive && !editor.isViewTabActive}
          <span class="status-cluster status-cluster-primary">
            <span class="status-segment">
              Ln {editor.cursorLine}, Col {editor.cursorColumn}
            </span>
            {#if editor.selectionCount > 1}
              <span
                class="status-segment"
                aria-label={`${editor.selectionCount} selections`}
              >
                {editor.selectionCount} selections
              </span>
            {/if}
          </span>
          {#if !statusOverflowNeeded}
            <span class="status-cluster status-cluster-document">
              <span class="status-segment">
                {#if editor.isImageDocument}
                  Image
                {:else if editor.isBinaryDocument}
                  Binary
                {:else if editor.isLargePendingDocument}
                  Large file
                {:else}
                  {editor.activeDocument?.encoding.toUpperCase() ?? "UTF-8"}
                {/if}
              </span>
              <span class="status-segment">
                {editor.activeDocument?.lineEnding.toUpperCase() ?? "LF"}
              </span>
              <span class="status-segment">
                {editor.wrapLines ? "Wrap: On" : "Wrap: Off"}
              </span>
            </span>
            <span class="status-cluster status-cluster-view">
              <span class="status-segment">{editor.zoomPercent}%</span>
            </span>
          {/if}
          <span class="status-cluster status-cluster-file">
            <span class="status-segment">
              {editor.activeDocument?.isDirty ? "Modified" : "Saved"}
            </span>
            {#if editor.activeDocument?.fileMissing}
              <span class="status-segment status-missing" title="File no longer exists on disk">
                File missing
              </span>
            {/if}
          </span>
        {/if}
        <span class="status-segment status-message">
          {statusBar.statusMessage}
        </span>
        <span
          class="status-segment path-segment"
          title={editor.activeDocument?.filePath ?? statusBar.statusPath}
        >
          {statusBar.statusPath}
        </span>
      </button>
      {#if statusOverflowNeeded && !editor.isSessionTabActive && !editor.isChatHttpActive && !editor.isViewTabActive}
        <div class="status-overflow">
          <button
            type="button"
            class="status-overflow-button"
            bind:this={statusOverflowButtonEl}
            aria-haspopup="menu"
            aria-expanded={statusOverflowOpen}
            aria-label="More status information"
            title="Hidden status details"
            onclick={toggleStatusOverflow}
          >
            «
          </button>
          {#if statusOverflowOpen}
            <div
              class="status-overflow-menu"
              role="menu"
              tabindex="-1"
              aria-label="More status information"
              bind:this={statusOverflowEl}
              onpointerdown={(event) => event.stopPropagation()}
            >
              <div class="status-overflow-row">
                <span class="status-overflow-label">Encoding</span>
                <span class="status-overflow-value">
                  {#if editor.isImageDocument}
                    Image
                  {:else if editor.isBinaryDocument}
                    Binary
                  {:else if editor.isLargePendingDocument}
                    Large file
                  {:else}
                    {editor.activeDocument?.encoding.toUpperCase() ?? "UTF-8"}
                  {/if}
                </span>
              </div>
              <div class="status-overflow-row">
                <span class="status-overflow-label">Line ending</span>
                <span class="status-overflow-value">
                  {editor.activeDocument?.lineEnding.toUpperCase() ?? "LF"}
                </span>
              </div>
              <div class="status-overflow-row">
                <span class="status-overflow-label">Wrap</span>
                <span class="status-overflow-value">
                  {editor.wrapLines ? "On" : "Off"}
                </span>
              </div>
              <div class="status-overflow-row">
                <span class="status-overflow-label">Zoom</span>
                <span class="status-overflow-value">{editor.zoomPercent}%</span>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </footer>
  </div>
</main>

<EntryNamePrompt onNotify={overlays.notify} />
{#if gitIntegrationEnabled}
<AskpassPrompt />
<TagPushPrompt />
<TagDeletePrompt />
<LocalChangesCheckoutPrompt />
<LocalChangesPullPrompt />
<LocalChangesStashApplyPrompt />
<StashDropPrompt />
<PreGitAutosavePrompt />
{/if}
<RevertPreviewDialog />
{#if sessionListPanel}
  <SessionListPanel
    open={sessionListPanel.open}
    sessions={sessionListPanel.sessions}
    openSessionIds={sessionListPanel.openSessionIds}
    activeSessionId={sessionListPanel.activeSessionId}
    loading={sessionListPanel.loading}
    errorMessage={sessionListPanel.errorMessage}
    sort={sessionListPanel.sort}
    searchQuery={sessionListPanel.searchQuery}
    onOpenSession={sessionListPanel.onOpenSession}
    onClose={sessionListPanel.onClose}
    onSearchChange={sessionListPanel.onSearchChange}
    onSortChange={sessionListPanel.onSortChange}
    onRefresh={sessionListPanel.onRefresh}
  />
{/if}

{#if addMultipleWorkspaces}
  <AddMultipleWorkspacesModal
    open={addMultipleWorkspaces.open}
    loading={addMultipleWorkspaces.loading}
    errorMessage={addMultipleWorkspaces.errorMessage}
    parentPath={addMultipleWorkspaces.parentPath}
    entries={addMultipleWorkspaces.entries}
    selected={addMultipleWorkspaces.selected}
    onToggleEntry={addMultipleWorkspaces.onToggleEntry}
    onConfirm={addMultipleWorkspaces.onConfirm}
    onCancel={addMultipleWorkspaces.onCancel}
  />
{/if}
<PermissionPrompt />
<QuestionPrompt />
<ConfirmDialog />

{#if commandPalette}
  <CommandPalettePicker
    open={commandPalette.open}
    results={commandPalette.results}
    onSelect={commandPalette.onSelect}
    onClose={commandPalette.onClose}
    onQueryInput={commandPalette.onQueryInput}
  />
{/if}

{#if quickOpen}
  <QuickOpenPicker
    open={quickOpen.open}
    results={quickOpen.results}
    onSelect={quickOpen.onSelect}
    onClose={quickOpen.onClose}
    onRefresh={quickOpen.onRefresh}
    onQueryInput={quickOpen.onQueryInput}
  />
{/if}

{#if headingJump}
  <HeadingJumpPicker
    open={headingJump.open}
    results={headingJump.results}
    onSelect={headingJump.onSelect}
    onClose={headingJump.onClose}
    onQueryInput={headingJump.onQueryInput}
  />
{/if}

{#if bookmarkList}
  <BookmarkListPicker
    open={bookmarkList.open}
    bookmarks={bookmarkList.bookmarks}
    onSelect={bookmarkList.onSelect}
    onClose={bookmarkList.onClose}
    onQueryInput={bookmarkList.onQueryInput}
  />
{/if}

{#if snippetInsert}
  <SnippetInsertPicker
    open={snippetInsert.open}
    results={snippetInsert.results}
    onSelect={snippetInsert.onSelect}
    onClose={snippetInsert.onClose}
    onQueryInput={snippetInsert.onQueryInput}
  />
{/if}

{#if timelineDialog}
  <SessionTimelineDialog
    open={timelineDialog.open}
    messages={timelineDialog.messages}
    searchQuery={timelineDialog.searchQuery}
    onJumpToMessage={timelineDialog.onJumpToMessage}
    onClose={timelineDialog.onClose}
    onSearchChange={timelineDialog.onSearchChange}
  />
{/if}

{#if workspaceContextMenu.menu}
  <div
    bind:this={workspaceContextMenuEl}
    class="workspace-context-menu"
    style={`left:${workspaceContextMenu.menu.x}px; top:${workspaceContextMenu.menu.y}px;`}
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
        if (!workspaceContextMenu.menu) {
          return;
        }
        workspaceContextMenu.onOpenSettings(workspaceContextMenu.menu.workspaceId);
      }}
    >
      Settings
    </button>
    {#if gitIntegrationEnabled}
    <button
      class="workspace-context-item"
      type="button"
      role="menuitem"
      onpointerdown={(event) => {
        event.stopPropagation();
        if (!workspaceContextMenu.menu) {
          return;
        }
        workspaceContextMenu.onOpenVersionControl(workspaceContextMenu.menu.workspaceId);
      }}
    >
      Version Control
    </button>
    {/if}
    <button
      class="workspace-context-item"
      type="button"
      role="menuitem"
      disabled={workspaceContextMenu.menuIndex <= 0 || workspaceContextMenu.workspaceCount <= 1}
      onpointerdown={(event) => {
        event.stopPropagation();
        workspaceContextMenu.onMoveUp();
      }}
    >
      Move Up
    </button>
    <button
      class="workspace-context-item"
      type="button"
      role="menuitem"
      disabled={workspaceContextMenu.menuIndex < 0 ||
        workspaceContextMenu.menuIndex >= workspaceContextMenu.workspaceCount - 1 ||
        workspaceContextMenu.workspaceCount <= 1}
      onpointerdown={(event) => {
        event.stopPropagation();
        workspaceContextMenu.onMoveDown();
      }}
    >
      Move Down
    </button>
    <button
      class="workspace-context-item"
      type="button"
      role="menuitem"
      onpointerdown={(event) => {
        event.stopPropagation();
        if (!workspaceContextMenu.menu) {
          return;
        }
        workspaceContextMenu.onCloseWorkspace(workspaceContextMenu.menu.workspaceId);
      }}
    >
      Close Workspace
    </button>
  </div>
{/if}
