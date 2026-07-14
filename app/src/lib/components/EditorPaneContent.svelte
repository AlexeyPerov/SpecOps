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
  import GoToLinePanel from "./GoToLinePanel.svelte";
  import MarkdownOutlinePanel from "./MarkdownOutlinePanel.svelte";
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
  import { appState } from "../state/appState";
  import { emptySet } from "../collections/emptyCollections";
  import { getEditorWorkbenchRuntime } from "../editor/editorWorkbenchContext";
  import { getEditorToolController } from "../editor/editorToolContext";
  import type { EditorToolSnapshot } from "../editor/editorToolController";

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
    onWorkspaceManagerOpenVersionControl = (_workspaceId: ContextId) => {},
    previewMode = "editor",
    wrapLines = false,
    zoomPercent = 100,
    decoratePlaintextSymbols = true,
    showMinimap = true,
    showFoldGutter = true,
    autoClosePairs = true,
    autoSuggest = false,
    maxBinaryOpenAsTextBytes = 0,
    maxOpenWithoutConfirmBytes = 0,
    canFitMarkdownSplit = true,
    windowId = "main",
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
    onWorkspaceManagerOpenVersionControl?: (workspaceId: ContextId) => void;
    previewMode: "editor" | "markdown" | "diff";
    wrapLines: boolean;
    zoomPercent: number;
    decoratePlaintextSymbols: boolean;
    showMinimap: boolean;
    showFoldGutter: boolean;
    autoClosePairs: boolean;
    autoSuggest: boolean;
    maxBinaryOpenAsTextBytes: number;
    maxOpenWithoutConfirmBytes: number;
    canFitMarkdownSplit: boolean;
    windowId: string;
    onActivePaneElement?: (element: HTMLElement | null) => void;
    onConfirmLargeFile: (documentId: string) => void | Promise<void>;
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
    notify: (message: string) => void;
  } = $props();

  const workbench = getEditorWorkbenchRuntime();
  const editorTools = getEditorToolController();
  const getActiveEditorHost = () => workbench.getActiveHost();
  const getActiveEditorRunner = () => workbench.getActiveRunner();

  let toolSnapshot = $state<EditorToolSnapshot>(editorTools.getSnapshot());
  $effect(() => editorTools.subscribe((next) => {
    toolSnapshot = next;
  }));

  const findReplaceOpen = $derived(toolSnapshot.activeTool === "find");
  const goToOpen = $derived(toolSnapshot.activeTool === "go-to");
  const outlineOpen = $derived(toolSnapshot.activeTool === "outline");

  let findQuery = $state("");
  let replaceValue = $state("");
  let findCaseSensitive = $state(false);
  let goToLineValue = $state("");

  $effect(() => {
    findQuery = toolSnapshot.find.query;
    replaceValue = toolSnapshot.find.replace;
    findCaseSensitive = toolSnapshot.find.caseSensitive;
    goToLineValue = toolSnapshot.goToLineValue;
  });

  $effect(() => {
    editorTools.setFindQuery(findQuery);
  });
  $effect(() => {
    editorTools.setFindReplace(replaceValue);
  });
  $effect(() => {
    editorTools.setFindCaseSensitive(findCaseSensitive);
  });
  $effect(() => {
    editorTools.setGoToLineValue(goToLineValue);
  });

  let paneSectionEl = $state<HTMLElement | null>(null);

  const layout = $derived(session.editorLayout);
  const selectedTab = $derived(paneActiveTab(layout, paneId));
  const isSessionTabActive = $derived(isSessionTabActiveInPane(layout, paneId));
  const activeViewTabKind = $derived(activeViewKindInPane(layout, paneId));
  const isSettingsViewActive = $derived(activeViewTabKind === "settings");
  const isThemesViewActive = $derived(activeViewTabKind === "themes");
  const isWorkspaceSettingsViewActive = $derived(activeViewTabKind === "workspace-settings");
  const isWorkspaceManagerViewActive = $derived(activeViewTabKind === "workspace-manager");
  const isVersionControlViewActive = $derived(
    activeViewTabKind === "version-control" && $appState.settings.gitIntegration.enabled,
  );

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

  let confirmingDocumentId = $state<string | null>(null);

  async function handleConfirmLargeFile(): Promise<void> {
    const documentId = paneDocument?.id;
    if (!documentId || confirmingDocumentId === documentId) {
      return;
    }
    confirmingDocumentId = documentId;
    try {
      await onConfirmLargeFile(documentId);
    } finally {
      if (confirmingDocumentId === documentId) {
        confirmingDocumentId = null;
      }
    }
  }

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
      onOpenVersionControl={onWorkspaceManagerOpenVersionControl}
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
      confirming={confirmingDocumentId === paneDocument?.id}
      onConfirm={handleConfirmLargeFile}
    />
  {:else if documentView.isTextEditorDocument}
    <div
      class="editor-pane-body"
      class:editor-pane-body-with-outline={isActivePane &&
        outlineOpen &&
        documentView.isMarkdownDocument}
    >
      <div class="editor-pane-primary">
        <MarkdownEditorPane
          markdownEnabled={documentView.isMarkdownDocument}
          content={paneDocument?.content ?? ""}
          documentId={paneDocument?.id ?? null}
          {paneId}
          documentFilePath={paneDocument?.filePath ?? null}
          scrollTop={paneDocument?.scrollTop ?? 0}
          language={paneDocument?.language ?? "plaintext"}
          {wrapLines}
          {zoomPercent}
          {decoratePlaintextSymbols}
          {showMinimap}
          {showFoldGutter}
          {autoClosePairs}
          {autoSuggest}
          markdownHtml={documentView.markdownHtml}
          storedMarkdownViewMode={paneDocument?.markdownViewMode ?? "edit"}
          canFitSplit={canFitMarkdownSplit}
          {windowId}
          onStatusMessage={notify}
          {onMarkdownViewModeChange}
          {onUntitledTitleRefresh}
          {onScrollTopChange}
        />
      </div>
      {#if isActivePane && outlineOpen && documentView.isMarkdownDocument && !isSessionTabActive && !isChatHttpActive}
        <MarkdownOutlinePanel
          getHost={getActiveEditorHost}
          requestFocus={true}
          onJump={(headingKey) => {
            // Preview-only: switch to edit so the CodeMirror host can reveal the heading.
            if (paneDocument?.markdownViewMode === "preview") {
              onMarkdownViewModeChange("edit");
            }
            const host = getActiveEditorHost();
            host?.actions.navigation.jumpToHeading(headingKey);
            host?.focus();
          }}
          onClose={() => editorTools.close({ restoreFocus: true })}
        />
      {/if}
    </div>
  {/if}

  {#if isActivePane && documentView.isTextEditorDocument && !isSessionTabActive && !isChatHttpActive && findReplaceOpen}
    <FindReplacePanel
      bind:findQuery
      bind:replaceValue
      bind:findCaseSensitive
      getEditorRunner={getActiveEditorRunner}
      {notify}
      documentId={paneDocument?.id ?? null}
      onClose={() => editorTools.close({ restoreFocus: true })}
    />
  {/if}

  {#if isActivePane && documentView.isTextEditorDocument && !isSessionTabActive && !isChatHttpActive && goToOpen}
    <GoToLinePanel
      bind:lineValue={goToLineValue}
      onGo={onGoToLine}
      onClose={() => editorTools.close({ restoreFocus: true })}
    />
  {/if}
</section>

<style>
  .editor-pane-inactive {
    /* Keep mounted editors alive but de-emphasize inactive pane chrome. */
    opacity: 0.92;
  }

  .editor-pane-body {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    height: 100%;
  }

  .editor-pane-primary {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
</style>
