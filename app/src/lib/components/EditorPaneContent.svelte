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
    findPane,
    isFileTab,
    paneActiveTab,
    tabDocumentId,
    type ContextId,
    type DocumentState,
    type SessionState,
    type TabState,
    type WorkspaceEntry,
  } from "../domain/contracts";
  import { deriveAppShellDocumentView } from "../services/appShellDocumentView";
  import { appState } from "../state/appState";
  import { logPerfTiming } from "../services/perfDiagnostics";
  import { emptySet } from "../collections/emptyCollections";
  import { getEditorWorkbenchRuntime } from "../editor/editorWorkbenchContext";
  import { getEditorToolController } from "../editor/editorToolContext";
  import type { EditorToolSnapshot } from "../editor/editorToolController";

  let {
    paneId,
    isActivePane = false,
    session,
    documents,
    /** Editor context id — namespaces the editor host/session cache and
     *  scopes the keep-alive set so contexts with overlapping pane/tab ids do
     *  not collide when multiple editor trees stay mounted. */
    contextId,
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
    contextId: ContextId;
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
  let findWholeWord = $state(false);
  let findRegexp = $state(false);
  let goToLineValue = $state("");
  /**
   * Text captured from the editor's main selection at the moment Find opens.
   * Used to seed the query when the selection is non-empty and single-ranged;
   * empty when there is nothing useful to seed.
   */
  let findReplaceSeedSelection = $state("");
  let prevFindReplaceOpen = false;

  $effect(() => {
    findQuery = toolSnapshot.find.query;
    replaceValue = toolSnapshot.find.replace;
    findCaseSensitive = toolSnapshot.find.caseSensitive;
    findWholeWord = toolSnapshot.find.wholeWord;
    findRegexp = toolSnapshot.find.regexp;
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
    editorTools.setFindWholeWord(findWholeWord);
  });
  $effect(() => {
    editorTools.setFindRegexp(findRegexp);
  });
  $effect(() => {
    editorTools.setGoToLineValue(goToLineValue);
  });

  // Seed the find query from a non-empty single selection when Find opens.
  $effect(() => {
    const isOpen = findReplaceOpen;
    if (isOpen && !prevFindReplaceOpen) {
      const host = getActiveEditorHost();
      const selResult = host?.queries.selection.getSelection();
      if (host && selResult?.ok && !selResult.value.empty) {
        const docResult = host.queries.document.getDocumentContent();
        if (docResult.ok) {
          findReplaceSeedSelection = docResult.value.slice(
            selResult.value.from,
            selResult.value.to,
          );
        }
      } else {
        findReplaceSeedSelection = "";
      }
    }
    prevFindReplaceOpen = isOpen;
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

  // ---- Editor tab keep-alive -------------------------------------------------
  // File-tab content (CodeMirror) is kept mounted across tab switches within
  // this pane so that switching editor tabs is a CSS visibility toggle instead
  // of a full EditorView destroy/recreate. Without this, every editor tab
  // switch destroyed the CodeMirror view and invalidated the pane's editor
  // session cache (undo history, folds, selection were lost), and the view had
  // to be rebuilt from scratch on return.
  //
  // Scope: only text-editor file tabs are kept alive. Session/chat/view tabs
  // and non-text documents (image/binary/large-pending) keep using the
  // single-branch {#if} chain below; they are singletons or cheap to remount.
  // The set grows as tabs are visited and is pruned when tabs are closed so it
  // does not accumulate forever.
  const activeTabId = $derived(selectedTab?.id ?? null);
  const paneFileTabs = $derived(
    (findPane(layout, paneId)?.tabs.filter((tab) => isFileTab(tab)) ?? []) as Extract<
      TabState,
      { kind: "file" }
    >[],
  );
  const paneFileTabIds = $derived(new Set(paneFileTabs.map((tab) => tab.id)));
  let visitedEditorTabIds = $state<Set<string>>(new Set());

  // Reset keep-alive state when the editor context changes. Tab ids are
  // context-local, so a carry-over set would render stale slots (with the wrong
  // document / cached CodeMirror state) when the same EditorPaneContent instance
  // receives a different context's session/documents after the {#key} is removed.
  $effect(() => {
    contextId;
    visitedEditorTabIds = new Set();
    confirmingDocumentId = null;
  });

  $effect(() => {
    // Capture the reactive reads so this re-runs when the active tab or the
    // pane's file-tab set changes.
    const activeId = activeTabId;
    const openIds = paneFileTabIds;
    // Prune ids that have been closed.
    let next = visitedEditorTabIds;
    let changed = false;
    for (const id of visitedEditorTabIds) {
      if (!openIds.has(id)) {
        if (next === visitedEditorTabIds) {
          next = new Set(visitedEditorTabIds);
          changed = true;
        }
        next.delete(id);
      }
    }
    // Add the active tab if it is currently a text-editor document. We rely on
    // `documentView.isTextEditorDocument` (derived from the active tab's
    // document) to decide; that flag already excludes image/binary/large docs.
    if (activeId && documentView.isTextEditorDocument && !visitedEditorTabIds.has(activeId)) {
      if (next === visitedEditorTabIds) {
        next = new Set(visitedEditorTabIds);
      }
      next.add(activeId);
      changed = true;
      // Observable signal: a one-time mount cost per tab. Repeat visits to an
      // already-kept-alive tab produce no such log, which is the keep-alive win
      // (file→file tab switches become CSS visibility toggles, not remounts).
      void logPerfTiming(
        "editor tab keep-alive slot mounted",
        {
          metric: "tab.activationSideEffects",
          durationMs: 0,
          label: "editor-keepalive-mount",
          paneId,
          tabId: activeId,
          liveSlotCount: next.size,
        },
        "debug",
      );
    }
    if (changed) {
      visitedEditorTabIds = next;
    }
  });

  /**
   * Entries to keep alive: visited file tabs that are still open AND still
   * resolve to a text-editor document. Each entry carries its own document so
   * the per-tab MarkdownEditorPane binds to the right content. A tab whose
   * document became non-text (e.g. the file changed to binary on disk) is
   * dropped here and falls back to the active-tab {#if} branch.
   */
  const keepAliveEntries = $derived.by(() => {
    const entries: Array<{
      tabId: string;
      document: DocumentState;
    }> = [];
    for (const tab of paneFileTabs) {
      if (!visitedEditorTabIds.has(tab.id)) {
        continue;
      }
      const document = documents.find((d) => d.id === tab.documentId);
      if (!document) {
        continue;
      }
      const view = deriveAppShellDocumentView(document, {
        renderMarkdownHtml:
          document.language === "markdown"
            ? document.markdownViewMode === "preview" ||
              (document.markdownViewMode === "split" && canFitMarkdownSplit)
            : false,
      });
      if (view.isTextEditorDocument) {
        entries.push({ tabId: tab.id, document });
      }
    }
    return entries;
  });

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

  // Inactive panes must not keep keyboard focus in the editor surface.
  $effect(() => {
    if (isActivePane || !paneSectionEl || typeof document === "undefined") {
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && paneSectionEl.contains(active)) {
      active.blur();
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
        {#each keepAliveEntries as entry (entry.tabId)}
          {@const entryView = deriveAppShellDocumentView(entry.document, {
            renderMarkdownHtml:
              entry.document.language === "markdown"
                ? entry.document.markdownViewMode === "preview" ||
                  (entry.document.markdownViewMode === "split" && canFitMarkdownSplit)
                : false,
          })}
          {@const isEntryActive = entry.tabId === activeTabId}
          <div class="editor-tab-slot" class:editor-tab-slot-hidden={!isEntryActive}>
            <MarkdownEditorPane
              markdownEnabled={entryView.isMarkdownDocument}
              content={entry.document.content}
              documentId={entry.document.id}
              {paneId}
              {contextId}
              documentFilePath={entry.document.filePath}
              scrollTop={entry.document.scrollTop}
              language={entry.document.language}
              {wrapLines}
              {zoomPercent}
              {decoratePlaintextSymbols}
              {showMinimap}
              {showFoldGutter}
              {autoClosePairs}
              {autoSuggest}
              markdownHtml={entryView.markdownHtml}
              storedMarkdownViewMode={entry.document.markdownViewMode ?? "edit"}
              canFitSplit={canFitMarkdownSplit}
              {windowId}
              onStatusMessage={notify}
              {onMarkdownViewModeChange}
              {onUntitledTitleRefresh}
              {onScrollTopChange}
            />
          </div>
        {/each}
      </div>
      {#if isActivePane && outlineOpen && documentView.isMarkdownDocument && !isSessionTabActive && !isChatHttpActive}
        <MarkdownOutlinePanel
          getHost={getActiveEditorHost}
          documentId={paneDocument?.id ?? null}
          {paneId}
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
      bind:findWholeWord
      bind:findRegexp
      seedSelection={findReplaceSeedSelection}
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
  /*
   * Inactive pane policy (F1.6): keep the editor mounted, but block pointer
   * interaction on the editor surface. Pane chrome (tabs/header) lives in
   * EditorPaneView and still receives pointerdown to activate the pane.
   * Find/replace, go-to, and outline render only when isActivePane is true.
   */
  .editor-pane-inactive {
    opacity: 0.92;
    pointer-events: none;
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
    position: relative;
  }

  /*
   * Editor tab keep-alive: each visited file tab renders its MarkdownEditorPane
   * inside a slot. Only the active tab's slot is visible and fills the primary
   * area; the rest are taken out of flow via display:none so they neither paint
   * nor receive pointer events, while their CodeMirror EditorView (and thus
   * undo history, folds, scroll) is preserved across tab switches.
   */
  .editor-tab-slot {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .editor-tab-slot-hidden {
    display: none;
  }
</style>
