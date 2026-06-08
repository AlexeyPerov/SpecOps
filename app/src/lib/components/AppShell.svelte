<script lang="ts">
  import DocumentEditor from "./DocumentEditor.svelte";
  import MarkdownEditorPane from "./MarkdownEditorPane.svelte";
  import DiffPreviewPane from "./DiffPreviewPane.svelte";
  import ImagePreviewPane from "./ImagePreviewPane.svelte";
  import BinaryFilePane from "./BinaryFilePane.svelte";
  import LargeFileConfirmPane from "./LargeFileConfirmPane.svelte";
  import ConsolePanel from "./ConsolePanel.svelte";
  import SettingsDialog from "./SettingsDialog.svelte";
  import EntryNamePrompt from "./EntryNamePrompt.svelte";
  import ThemePane from "./ThemePane.svelte";
  import FindReplacePanel from "./FindReplacePanel.svelte";
  import TabBar from "./TabBar.svelte";
  import ActivityRail from "./ActivityRail.svelte";
  import ProjectPanel from "./ProjectPanel.svelte";
  import AgentsSidebar from "./AgentsSidebar.svelte";
  import ChatPanel from "./ChatPanel.svelte";
  import type { ProjectTreeControllerState } from "../services/projectTreeController";
  import type { ProjectTreeNode } from "../services/projectTree";
  import type { SettingsDialogTab } from "../services/settingsDialogUi";
  import type { EditorCommandRunner } from "../types/editor";
  import type {
    AgentIndexEntry,
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
    onSelectContext: (contextId: ContextId) => void;
    onAddWorkspace: () => void;
    onRequestCloseWorkspace: (workspaceId: ContextId, x: number, y: number) => void;
    onReorderWorkspaces: (fromIndex: number, toIndex: number) => void;
  }

  export interface AppShellAgentsSidebarProps {
    show: boolean;
    agents: AgentIndexEntry[];
    activeAgentId: string | null;
    sidebarTitle: string;
    collapsed: boolean;
    panelWidthPx: number;
    onToggleCollapsed: (next: boolean) => void;
    onPanelWidthChange: (widthPx: number) => void;
    onSelectAgent: (agentId: string) => void;
    onNewAgent: () => void;
    onDeleteAgent: (agentId: string) => void | Promise<void>;
  }

  export interface AppShellProjectTreeProps {
    workspaceRoot: string | null;
    state: ProjectTreeControllerState;
    activeFilePath: string | null;
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
    isAgentTabActive: boolean;
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
    onDeleteAgentFromChat: () => void | Promise<void>;
    onGoToLine: () => void;
    onCloseGoTo: () => void;
    notify: (message: string) => void;
  }

  export interface AppShellStatusBarProps {
    statusPath: string;
    statusMessage: string;
    consoleOpen: boolean;
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

  export interface AppShellOverlayProps {
    themePaneOpen: boolean;
    settingsDialogOpen: boolean;
    settingsDialogInitialTab: SettingsDialogTab;
    onSettingsDialogClose: () => void;
    notify: (message: string) => void;
  }

  let {
    activityRail,
    agentsSidebar,
    projectTree,
    editor,
    statusBar,
    workspaceContextMenu,
    overlays,
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
    agentsSidebar: AppShellAgentsSidebarProps;
    projectTree: AppShellProjectTreeProps;
    editor: AppShellEditorChromeProps;
    statusBar: AppShellStatusBarProps;
    workspaceContextMenu: AppShellWorkspaceContextMenuProps;
    overlays: AppShellOverlayProps;
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
  <div class="shell-main-row" bind:this={shellMainRowEl}>
    {#if activityRail.show}
      <ActivityRail
        workspaces={activityRail.workspaces}
        activeContextId={activityRail.activeContextId}
        showChatHttp={activityRail.chatHttpRailVisible}
        onSelectContext={activityRail.onSelectContext}
        onAddWorkspace={activityRail.onAddWorkspace}
        onRequestCloseWorkspace={activityRail.onRequestCloseWorkspace}
        onReorderWorkspaces={activityRail.onReorderWorkspaces}
      />
    {/if}
    {#if agentsSidebar.show}
      <AgentsSidebar
        agents={agentsSidebar.agents}
        activeAgentId={agentsSidebar.activeAgentId}
        sidebarTitle={agentsSidebar.sidebarTitle}
        collapsed={agentsSidebar.collapsed}
        panelWidthPx={agentsSidebar.panelWidthPx}
        onToggleCollapsed={agentsSidebar.onToggleCollapsed}
        onPanelWidthChange={agentsSidebar.onPanelWidthChange}
        onSelectAgent={agentsSidebar.onSelectAgent}
        onNewAgent={agentsSidebar.onNewAgent}
        onDeleteAgent={(agentId) => void agentsSidebar.onDeleteAgent(agentId)}
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
        <div class="header-right">
          <button
            class="toolbar-button"
            type="button"
            onclick={() => editor.onRunCommand("app.toggleThemePane")}
          >
            Theme
          </button>
        </div>
      </header>

      <section
        class="editor-pane"
        class:editor-pane-agent={editor.isAgentTabActive}
        bind:this={editorPaneEl}
      >
        {#if editor.isChatHttpActive || editor.isAgentTabActive}
          <ChatPanel
            chatContextKind={editor.isChatHttpActive ? "chat-http" : "workspace"}
            onDeleteAgent={editor.onDeleteAgentFromChat}
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

        {#if editor.isTextEditorDocument && !editor.isAgentTabActive && !editor.isChatHttpActive && editor.findReplaceOpen}
          <FindReplacePanel
            bind:findQuery
            bind:replaceValue
            bind:findCaseSensitive
            {editorRunner}
            notify={editor.notify}
            documentId={editor.activeDocument?.id ?? null}
          />
        {/if}

        {#if editor.isTextEditorDocument && !editor.isAgentTabActive && !editor.isChatHttpActive && editor.goToOpen}
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
        <ThemePane open={overlays.themePaneOpen} />
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
  </div>

  <div class="bottom-panel">
    {#if consoleOpen}
      <ConsolePanel bind:heightPx={consoleHeightPx} onHeightCommit={onConsoleHeightCommit} />
    {/if}

    <footer class="status-bar" class:status-bar-console-open={consoleOpen}>
      <button
        type="button"
        class="status-bar-button"
        title={consoleOpen ? "Hide console" : "Show console"}
        onclick={statusBar.onToggleConsole}
      >
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

<SettingsDialog
  open={overlays.settingsDialogOpen}
  initialTab={overlays.settingsDialogInitialTab}
  onClose={overlays.onSettingsDialogClose}
/>

<EntryNamePrompt onNotify={overlays.notify} />

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
