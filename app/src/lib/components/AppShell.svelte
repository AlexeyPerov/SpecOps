<script lang="ts">
  import DocumentEditor from "./DocumentEditor.svelte";
  import MarkdownEditorPane from "./MarkdownEditorPane.svelte";
  import DiffPreviewPane from "./DiffPreviewPane.svelte";
  import ImagePreviewPane from "./ImagePreviewPane.svelte";
  import BinaryFilePane from "./BinaryFilePane.svelte";
  import LargeFileConfirmPane from "./LargeFileConfirmPane.svelte";
  import ConsolePanel from "./ConsolePanel.svelte";
  import SettingsView from "./settings/SettingsView.svelte";
  import ThemesView from "./ThemesView.svelte";
  import EntryNamePrompt from "./EntryNamePrompt.svelte";
  import RevertPreviewDialog from "./RevertPreviewDialog.svelte";
  import SessionListPanel from "./SessionListPanel.svelte";
  import PermissionPrompt from "./PermissionPrompt.svelte";
  import QuestionPrompt from "./QuestionPrompt.svelte";
  import FindReplacePanel from "./FindReplacePanel.svelte";
  import TabBar from "./TabBar.svelte";
  import ActivityRail from "./ActivityRail.svelte";
  import ProjectPanel from "./ProjectPanel.svelte";
  import SessionsSidebar from "./SessionsSidebar.svelte";
  import ChatPanel from "./ChatPanel.svelte";
  import TodoPanel from "./TodoPanel.svelte";
  import DiffViewerPanel from "./DiffViewerPanel.svelte";
  import SessionTimelineDialog from "./SessionTimelineDialog.svelte";
  import type { ProjectTreeControllerState } from "../services/projectTreeController";
  import type { ProjectTreeNode } from "../services/projectTree";
  import TitleBar from "./TitleBar.svelte";
  import type { EditorCommandRunner } from "../types/editor";
  import type {
    SessionIndexEntry,
    AppCommandId,
    ContextId,
    DocumentState,
    SessionState,
    WorkspaceEntry,
  } from "../domain/contracts";
  import "../styles/app-shell.css";

  export interface AppShellActivityRailProps {
    show: boolean;
    workspaces: WorkspaceEntry[];
    activeContextId: ContextId;
    chatHttpRailVisible: boolean;
    panelWidthPx: number;
    notepadOpenTabCount: number;
    notepadRecentTabs: { tabId: string; label: string }[];
    onSelectContext: (contextId: ContextId) => void;
    onAddWorkspace: () => void;
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
    notify: (message: string) => void;
  }

  export interface AppShellEditorChromeProps {
    session: SessionState;
    documents: DocumentState[];
    activeDocument: DocumentState | undefined;
    isChatHttpActive: boolean;
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
    findReplaceOpen: boolean;
    goToOpen: boolean;
    wrapLines: boolean;
    zoomPercent: number;
    cursorLine: number;
    cursorColumn: number;
    decoratePlaintextSymbols: boolean;
    maxBinaryOpenAsTextBytes: number;
    maxOpenWithoutConfirmBytes: number;
    largeFileConfirming: boolean;
    canFitMarkdownSplit: boolean;
    currentWindowId: string;
    onCloseTab: (tabId: string) => void | Promise<void>;
    onRunCommand: (commandId: AppCommandId) => void;
    onConfirmLargeFile: () => void | Promise<void>;
    onMarkdownViewModeChange: (nextMode: "edit" | "split" | "preview") => void;
    onUntitledTitleRefresh: (documentId: string) => void;
    onScrollTopChange: (documentId: string, scrollTop: number) => void;
    onDeleteSessionFromChat: () => void | Promise<void>;
    onGoToLine: () => void;
    onCloseGoTo: () => void;
    notify: (message: string) => void;
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

  export interface AppShellWorkspaceContextMenuProps {
    menu: { workspaceId: ContextId; x: number; y: number } | null;
    menuIndex: number;
    workspaceCount: number;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onCloseWorkspace: (workspaceId: ContextId) => void;
  }

  /**
   * M5-T4 — status popover trigger. `statusButtonVisible` gates the title-bar
   * button (workspace open + OpenCode enabled); `statusButtonActive` toggles
   * the popover open state.
   */
  export interface AppShellStatusPopoverProps {
    statusButtonVisible: boolean;
    statusButtonActive: boolean;
    workspaceRootPath: string | null;
    onToggleStatus: () => void;
    onStatusClose: () => void;
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

  let {
    activityRail,
    sessionsSidebar,
    projectTree,
    editor,
    statusBar,
    workspaceContextMenu,
    overlays,
    sessionListPanel,
    todoPanel,
    diffPanel,
    statusPopover,
    timelineDialog,
    onConsoleHeightCommit,
    consoleOpen = false,
    consoleHeightPx = $bindable(0),
    editorRunner = $bindable<EditorCommandRunner | null>(null),
    findQuery = $bindable(""),
    replaceValue = $bindable(""),
    findCaseSensitive = $bindable(false),
    goToLineValue = $bindable(""),
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
    workspaceContextMenu: AppShellWorkspaceContextMenuProps;
    overlays: AppShellOverlayProps;
    sessionListPanel?: AppShellSessionListPanelProps;
    todoPanel?: AppShellTodoPanelProps;
    diffPanel?: AppShellDiffPanelProps;
    statusPopover?: AppShellStatusPopoverProps;
    timelineDialog?: AppShellTimelineDialogProps;
    onConsoleHeightCommit: () => void;
    consoleOpen?: boolean;
    consoleHeightPx?: number;
    editorRunner?: EditorCommandRunner | null;
    findQuery?: string;
    replaceValue?: string;
    findCaseSensitive?: boolean;
    goToLineValue?: string;
    shellMainRowEl?: HTMLDivElement | null;
    editorShellEl?: HTMLElement | null;
    editorPaneEl?: HTMLElement | null;
    workspaceContextMenuEl?: HTMLDivElement | null;
  } = $props();
</script>

<main class="shell">
  <TitleBar
    statusButtonVisible={Boolean(statusPopover?.statusButtonVisible)}
    statusButtonActive={Boolean(statusPopover?.statusButtonActive)}
    statusWorkspaceRoot={statusPopover?.workspaceRootPath ?? null}
    onToggleStatus={() => statusPopover?.onToggleStatus()}
    onStatusClose={() => statusPopover?.onStatusClose()}
  />
  <div class="shell-main-row" bind:this={shellMainRowEl}>
    {#if activityRail.show}
      <ActivityRail
        workspaces={activityRail.workspaces}
        activeContextId={activityRail.activeContextId}
        showChatHttp={activityRail.chatHttpRailVisible}
        panelWidthPx={activityRail.panelWidthPx}
        notepadOpenTabCount={activityRail.notepadOpenTabCount}
        notepadRecentTabs={activityRail.notepadRecentTabs}
        onSelectContext={activityRail.onSelectContext}
        onAddWorkspace={activityRail.onAddWorkspace}
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
      <header class="tab-header">
        <div class="header-left">
          <TabBar
            openTabs={editor.session.openTabs}
            documents={editor.documents}
            selectedTabId={editor.session.selectedTabId}
            useChatTerminology={editor.isChatHttpActive}
            windowId={editor.currentWindowId}
            notify={editor.notify}
            onCloseTab={editor.onCloseTab}
          />
          {#if !editor.isChatHttpActive}
            <button
              class="toolbar-button add-file-button"
              type="button"
              aria-label="Create new untitled file"
              title="New Untitled File"
              onclick={() => editor.onRunCommand("file.new")}
            >
              +
            </button>
          {/if}
        </div>
      </header>

      <section
        class="editor-pane"
        class:editor-pane-session={editor.isSessionTabActive}
        bind:this={editorPaneEl}
      >
        {#if editor.isSettingsViewActive}
          <SettingsView />
        {:else if editor.isThemesViewActive}
          <ThemesView />
        {:else if editor.isChatHttpActive || editor.isSessionTabActive}
          <ChatPanel
            chatContextKind={editor.isChatHttpActive ? "chat-http" : "workspace"}
            onDeleteSession={editor.onDeleteSessionFromChat}
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
          />
        {:else if editor.previewMode === "diff"}
          <DiffPreviewPane
            savedContent={editor.activeDocument?.savedContent ?? ""}
            currentContent={editor.activeDocument?.content ?? ""}
          />
        {:else if editor.isImageDocument}
          <ImagePreviewPane
            filePath={editor.activeDocument?.filePath ?? null}
            title={editor.activeDocument?.title ?? "Image"}
            sizeBytes={editor.previewFileSizeBytes}
          />
        {:else if editor.isBinaryDocument}
          <BinaryFilePane
            filePath={editor.activeDocument?.filePath ?? null}
            title={editor.activeDocument?.title ?? "Binary file"}
            sizeBytes={editor.previewFileSizeBytes}
            maxOpenAsTextBytes={editor.maxBinaryOpenAsTextBytes}
          />
        {:else if editor.isLargePendingDocument}
          <LargeFileConfirmPane
            filePath={editor.activeDocument?.filePath ?? null}
            title={editor.activeDocument?.title ?? "Large file"}
            sizeBytes={editor.previewFileSizeBytes}
            maxOpenWithoutConfirmBytes={editor.maxOpenWithoutConfirmBytes}
            confirming={editor.largeFileConfirming}
            onConfirm={editor.onConfirmLargeFile}
          />
        {:else}
          {#if editor.isMarkdownDocument}
            <MarkdownEditorPane
              content={editor.activeDocument?.content ?? ""}
              documentId={editor.activeDocument?.id ?? null}
              documentFilePath={editor.activeDocument?.filePath ?? null}
              scrollTop={editor.activeDocument?.scrollTop ?? 0}
              language={editor.activeDocument?.language ?? "markdown"}
              wrapLines={editor.wrapLines}
              zoomPercent={editor.zoomPercent}
              decoratePlaintextSymbols={editor.decoratePlaintextSymbols}
              markdownHtml={editor.markdownHtml}
              storedMarkdownViewMode={editor.activeDocument?.markdownViewMode ?? "edit"}
              canFitSplit={editor.canFitMarkdownSplit}
              windowId={editor.currentWindowId}
              onStatusMessage={editor.notify}
              onMarkdownViewModeChange={editor.onMarkdownViewModeChange}
              onUntitledTitleRefresh={editor.onUntitledTitleRefresh}
              onScrollTopChange={editor.onScrollTopChange}
              registerEditorCommandRunner={(runner) => {
                editorRunner = runner;
              }}
            />
          {:else}
            <DocumentEditor
              content={editor.activeDocument?.content ?? ""}
              documentId={editor.activeDocument?.id ?? null}
              scrollTop={editor.activeDocument?.scrollTop ?? 0}
              wrapLines={editor.wrapLines}
              zoomPercent={editor.zoomPercent}
              language={editor.activeDocument?.language ?? "plaintext"}
              decoratePlaintextSymbols={editor.decoratePlaintextSymbols}
              onStatusMessage={editor.notify}
              onUntitledTitleRefresh={editor.onUntitledTitleRefresh}
              onScrollTopChange={editor.onScrollTopChange}
              registerEditorCommandRunner={(runner) => {
                editorRunner = runner;
              }}
            />
          {/if}
        {/if}

        {#if editor.isTextEditorDocument && !editor.isSessionTabActive && !editor.isChatHttpActive && editor.findReplaceOpen}
          <FindReplacePanel
            bind:findQuery
            bind:replaceValue
            bind:findCaseSensitive
            {editorRunner}
            notify={editor.notify}
            documentId={editor.activeDocument?.id ?? null}
          />
        {/if}

        {#if editor.isTextEditorDocument && !editor.isSessionTabActive && !editor.isChatHttpActive && editor.goToOpen}
          <div class="floating-tool goto-tool">
            <h3>Go To Line</h3>
            <input placeholder="Line number..." bind:value={goToLineValue} />
            <div class="tool-actions">
              <button type="button" class="toolbar-button" onclick={editor.onGoToLine}>Go</button>
              <button type="button" class="toolbar-button" onclick={editor.onCloseGoTo}>
                Close
              </button>
            </div>
          </div>
        {/if}
      </section>
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
    {#if consoleOpen}
      <ConsolePanel bind:heightPx={consoleHeightPx} onHeightCommit={onConsoleHeightCommit} />
    {/if}

    <footer class="status-bar" class:status-bar-console-open={consoleOpen}>
      <button
        type="button"
        class="status-bar-button"
        class:status-bar-button-static={!statusBar.canOpenLogsPanel}
        disabled={!statusBar.canOpenLogsPanel}
        title={statusBar.canOpenLogsPanel
          ? consoleOpen
            ? "Hide console"
            : "Show console"
          : undefined}
        onclick={statusBar.onToggleConsole}
      >
        {#if !editor.isSessionTabActive && !editor.isChatHttpActive && !editor.isViewTabActive}
          <span class="status-segment optional-segment optional-cursor">
            Ln {editor.cursorLine}, Col {editor.cursorColumn}
          </span>
          <span class="status-segment optional-segment optional-encoding">
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
          <span class="status-segment optional-segment optional-line-ending">
            {editor.activeDocument?.lineEnding.toUpperCase() ?? "LF"}
          </span>
          <span class="status-segment optional-segment optional-zoom">
            {editor.zoomPercent}%
          </span>
          <span class="status-segment optional-segment optional-wrap">
            {editor.wrapLines ? "Wrap: On" : "Wrap: Off"}
          </span>
          <span class="status-segment">
            {editor.activeDocument?.isDirty ? "Modified" : "Saved"}
          </span>
          {#if editor.activeDocument?.fileMissing}
            <span class="status-segment status-missing" title="File no longer exists on disk">
              File missing
            </span>
          {/if}
        {/if}
        <span class="status-segment status-message optional-segment optional-message">
          {statusBar.statusMessage}
        </span>
        <span
          class="status-segment path-segment"
          title={editor.activeDocument?.filePath ?? statusBar.statusPath}
        >
          {statusBar.statusPath}
        </span>
      </button>
    </footer>
  </div>
</main>

<EntryNamePrompt onNotify={overlays.notify} />
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
<PermissionPrompt />
<QuestionPrompt />

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
