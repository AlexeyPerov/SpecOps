<script lang="ts">
  import MarkdownEditorPane from "./MarkdownEditorPane.svelte";
  import DiffPreviewPane from "./DiffPreviewPane.svelte";
  import ImagePreviewPane from "./ImagePreviewPane.svelte";
  import BinaryFilePane from "./BinaryFilePane.svelte";
  import LargeFileConfirmPane from "./LargeFileConfirmPane.svelte";
  import SettingsView from "./settings/SettingsView.svelte";
  import WorkspaceSettingsView from "./settings/WorkspaceSettingsView.svelte";
  import WorkspaceManagerView from "./WorkspaceManagerView.svelte";
  import VersionControlView from "./VersionControlView.svelte";
  import ThemesView from "./ThemesView.svelte";
  import ChatPanel from "./ChatPanel.svelte";
  import FindReplacePanel from "./FindReplacePanel.svelte";
  import {
    activeViewKindInPane,
    isSessionTabActiveInPane,
  } from "./editorRouting";
  import {
    paneActiveTab,
    tabDocumentId,
    type ContextId,
    type DocumentState,
    type SessionState,
    type WorkspaceEntry,
  } from "../domain/contracts";
  import { deriveAppShellDocumentView } from "../services/appShellDocumentView";
  import type { EditorCommandRunner } from "../types/editor";
  import { emptySet } from "../collections/emptyCollections";

  let {
    paneId,
    isActivePane = false,
    session,
    documents,
    isChatHttpActive = false,
    /** Active workspace root path, used by the workspace-settings view tab. */
    workspaceRootPath = null,
    /** Window-session workspaces, used by the workspace-manager view tab. */
    workspaceManagerWorkspaces = [],
    /** Active context id, used by the workspace-manager view tab. */
    workspaceManagerActiveContextId = "notepad",
    /** Normalized root paths hidden from the activity rail. */
    workspaceManagerHiddenRootPaths = emptySet<string>(),
    /** Callbacks for the workspace-manager view tab. */
    onWorkspaceManagerAddWorkspace = () => {},
    onWorkspaceManagerAddMultiple = () => {},
    onWorkspaceManagerSelectWorkspace = (_workspaceId: ContextId) => {},
    onWorkspaceManagerOpenSettings = (_workspaceId: ContextId) => {},
    previewMode = "editor",
    findReplaceOpen = false,
    goToOpen = false,
    wrapLines = false,
    zoomPercent = 100,
    decoratePlaintextSymbols = true,
    maxBinaryOpenAsTextBytes = 0,
    maxOpenWithoutConfirmBytes = 0,
    largeFileConfirming = false,
    canFitMarkdownSplit = true,
    windowId = "main",
    findQuery = $bindable(""),
    replaceValue = $bindable(""),
    findCaseSensitive = $bindable(false),
    goToLineValue = $bindable(""),
    editorRunner = null,
    onActivePaneElement,
    onConfirmLargeFile,
    onMarkdownViewModeChange,
    onUntitledTitleRefresh,
    onScrollTopChange,
    onDeleteSessionFromChat,
    onForkSession,
    onRevertSession,
    onUnrevertSession,
    onShareSession,
    onUnshareSession,
    onSummarizeSession,
    onExportSession,
    activeShareUrl = null,
    activeParentSessionId = null,
    canToggleTodoPanel = false,
    todoPanelOpen = false,
    onToggleTodoPanel,
    canToggleDiffPanel = false,
    diffPanelOpen = false,
    onToggleDiffPanel,
    onOpenTimeline,
    onGoToLine,
    onCloseGoTo,
    onRegisterEditorCommandRunner,
    notify,
  }: {
    paneId: string;
    isActivePane: boolean;
    session: SessionState;
    documents: DocumentState[];
    isChatHttpActive: boolean;
    workspaceRootPath?: string | null;
    workspaceManagerWorkspaces?: WorkspaceEntry[];
    workspaceManagerActiveContextId?: ContextId;
    workspaceManagerHiddenRootPaths?: Set<string>;
    onWorkspaceManagerAddWorkspace?: () => void;
    onWorkspaceManagerAddMultiple?: () => void;
    onWorkspaceManagerSelectWorkspace?: (workspaceId: ContextId) => void;
    onWorkspaceManagerOpenSettings?: (workspaceId: ContextId) => void;
    previewMode: "editor" | "markdown" | "diff";
    findReplaceOpen: boolean;
    goToOpen: boolean;
    wrapLines: boolean;
    zoomPercent: number;
    decoratePlaintextSymbols: boolean;
    maxBinaryOpenAsTextBytes: number;
    maxOpenWithoutConfirmBytes: number;
    largeFileConfirming: boolean;
    canFitMarkdownSplit: boolean;
    windowId: string;
    findQuery?: string;
    replaceValue?: string;
    findCaseSensitive?: boolean;
    goToLineValue?: string;
    editorRunner?: EditorCommandRunner | null;
    onActivePaneElement?: (element: HTMLElement | null) => void;
    onConfirmLargeFile: () => void | Promise<void>;
    onMarkdownViewModeChange: (mode: "edit" | "split" | "preview") => void;
    onUntitledTitleRefresh: (documentId: string) => void;
    onScrollTopChange: (documentId: string, scrollTop: number) => void;
    onDeleteSessionFromChat: () => void | Promise<void>;
    onForkSession?: (messageId?: string) => void | Promise<void>;
    onRevertSession?: (messageId?: string) => void | Promise<void>;
    onUnrevertSession?: () => void | Promise<void>;
    onShareSession?: () => void | Promise<void>;
    onUnshareSession?: () => void | Promise<void>;
    onSummarizeSession?: () => void | Promise<void>;
    onExportSession?: () => void | Promise<void>;
    activeShareUrl?: string | null;
    activeParentSessionId?: string | null;
    canToggleTodoPanel?: boolean;
    todoPanelOpen?: boolean;
    onToggleTodoPanel?: () => void;
    canToggleDiffPanel?: boolean;
    diffPanelOpen?: boolean;
    onToggleDiffPanel?: () => void;
    onOpenTimeline?: () => void;
    onGoToLine: () => void;
    onCloseGoTo: () => void;
    onRegisterEditorCommandRunner?: (runner: EditorCommandRunner) => void;
    notify: (message: string) => void;
  } = $props();

  let paneSectionEl = $state<HTMLElement | null>(null);

  const layout = $derived(session.editorLayout);
  const selectedTab = $derived(paneActiveTab(layout, paneId));
  const isSessionTabActive = $derived(isSessionTabActiveInPane(layout, paneId));
  const activeViewTabKind = $derived(activeViewKindInPane(layout, paneId));
  const isSettingsViewActive = $derived(activeViewTabKind === "settings");
  const isThemesViewActive = $derived(activeViewTabKind === "themes");
  const isWorkspaceSettingsViewActive = $derived(activeViewTabKind === "workspace-settings");
  const isWorkspaceManagerViewActive = $derived(activeViewTabKind === "workspace-manager");
  const isVersionControlViewActive = $derived(activeViewTabKind === "version-control");

  const paneDocument = $derived.by(() => {
    const docId = selectedTab ? tabDocumentId(selectedTab) : null;
    if (!docId) {
      return undefined;
    }
    return documents.find((documentState) => documentState.id === docId);
  });

  const shouldRenderMarkdownPreview = $derived.by(() => {
    if (!paneDocument || paneDocument.language !== "markdown") {
      return false;
    }
    if (paneDocument.markdownViewMode === "preview") {
      return true;
    }
    return paneDocument.markdownViewMode === "split" && canFitMarkdownSplit;
  });

  const documentView = $derived(
    deriveAppShellDocumentView(paneDocument, {
      renderMarkdownHtml: shouldRenderMarkdownPreview,
    }),
  );

  const showDiffPreview = $derived(isActivePane && previewMode === "diff");

  $effect(() => {
    if (isActivePane) {
      onActivePaneElement?.(paneSectionEl);
    }
  });
</script>

<section
  class="editor-pane"
  class:editor-pane-session={isSessionTabActive}
  class:editor-pane-inactive={!isActivePane}
  bind:this={paneSectionEl}
>
  {#if isSettingsViewActive}
    <SettingsView />
  {:else if isThemesViewActive}
    <ThemesView />
  {:else if isWorkspaceSettingsViewActive}
    <WorkspaceSettingsView workspaceRootPath={workspaceRootPath} />
  {:else if isWorkspaceManagerViewActive}
    <WorkspaceManagerView
      workspaces={workspaceManagerWorkspaces}
      activeContextId={workspaceManagerActiveContextId}
      hiddenRootPaths={workspaceManagerHiddenRootPaths}
      onAddWorkspace={onWorkspaceManagerAddWorkspace}
      onAddMultiple={onWorkspaceManagerAddMultiple}
      onSelectWorkspace={onWorkspaceManagerSelectWorkspace}
      onOpenWorkspaceSettings={onWorkspaceManagerOpenSettings}
    />
  {:else if isVersionControlViewActive}
    <VersionControlView workspaceRootPath={workspaceRootPath} {windowId} {notify} />
  {:else if isChatHttpActive || isSessionTabActive}
    <ChatPanel
      chatContextKind={isChatHttpActive ? "chat-http" : "workspace"}
      onDeleteSession={onDeleteSessionFromChat}
      {onForkSession}
      {onRevertSession}
      {onUnrevertSession}
      {onShareSession}
      {onUnshareSession}
      {onSummarizeSession}
      {onExportSession}
      {activeShareUrl}
      {activeParentSessionId}
      {canToggleTodoPanel}
      {todoPanelOpen}
      {onToggleTodoPanel}
      {canToggleDiffPanel}
      {diffPanelOpen}
      {onToggleDiffPanel}
      {onOpenTimeline}
    />
  {:else if showDiffPreview}
    <DiffPreviewPane
      savedContent={paneDocument?.savedContent ?? ""}
      currentContent={paneDocument?.content ?? ""}
    />
  {:else if documentView.isImageDocument}
    <ImagePreviewPane
      filePath={paneDocument?.filePath ?? null}
      title={paneDocument?.title ?? "Image"}
      sizeBytes={documentView.previewFileSizeBytes}
    />
  {:else if documentView.isBinaryDocument}
    <BinaryFilePane
      filePath={paneDocument?.filePath ?? null}
      title={paneDocument?.title ?? "Binary file"}
      sizeBytes={documentView.previewFileSizeBytes}
      maxOpenAsTextBytes={maxBinaryOpenAsTextBytes}
    />
  {:else if documentView.isLargePendingDocument}
    <LargeFileConfirmPane
      filePath={paneDocument?.filePath ?? null}
      title={paneDocument?.title ?? "Large file"}
      sizeBytes={documentView.previewFileSizeBytes}
      maxOpenWithoutConfirmBytes={maxOpenWithoutConfirmBytes}
      confirming={isActivePane && largeFileConfirming}
      onConfirm={onConfirmLargeFile}
    />
  {:else if documentView.isTextEditorDocument}
    <MarkdownEditorPane
      markdownEnabled={documentView.isMarkdownDocument}
      content={paneDocument?.content ?? ""}
      documentId={paneDocument?.id ?? null}
      documentFilePath={paneDocument?.filePath ?? null}
      scrollTop={paneDocument?.scrollTop ?? 0}
      language={paneDocument?.language ?? "plaintext"}
      {wrapLines}
      {zoomPercent}
      {decoratePlaintextSymbols}
      markdownHtml={documentView.markdownHtml}
      storedMarkdownViewMode={paneDocument?.markdownViewMode ?? "edit"}
      canFitSplit={canFitMarkdownSplit}
      {windowId}
      onStatusMessage={notify}
      {onMarkdownViewModeChange}
      {onUntitledTitleRefresh}
      {onScrollTopChange}
      registerEditorCommandRunner={isActivePane ? onRegisterEditorCommandRunner : undefined}
    />
  {/if}

  {#if isActivePane && documentView.isTextEditorDocument && !isSessionTabActive && !isChatHttpActive && findReplaceOpen}
    <FindReplacePanel
      bind:findQuery
      bind:replaceValue
      bind:findCaseSensitive
      {editorRunner}
      {notify}
      documentId={paneDocument?.id ?? null}
    />
  {/if}

  {#if isActivePane && documentView.isTextEditorDocument && !isSessionTabActive && !isChatHttpActive && goToOpen}
    <div class="floating-tool goto-tool">
      <h3>Go To Line</h3>
      <input placeholder="Line number..." bind:value={goToLineValue} />
      <div class="tool-actions">
        <button type="button" class="toolbar-button" onclick={onGoToLine}>Go</button>
        <button type="button" class="toolbar-button" onclick={onCloseGoTo}>Close</button>
      </div>
    </div>
  {/if}
</section>

<style>
  .editor-pane-inactive {
    /* Keep mounted editors alive but de-emphasize inactive pane chrome. */
    opacity: 0.92;
  }
</style>
