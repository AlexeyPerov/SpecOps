<script lang="ts">
  import { untrack } from "svelte";
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
  import {
    deriveAppShellDocumentViewMemoized,
    isTextEditorDocumentState,
    renderMemoizedDocumentMarkdown,
  } from "../services/appShellDocumentView";
  import { getDocumentByIdMap } from "../services/tabDocumentLookup";
  import { appSettings } from "../state/appStateSelectors";
  import { logPerfTiming } from "../services/perfDiagnostics";
  import { isGitIntegrationEnabled } from "../services/gitIntegrationSettings";
  import { emptySet } from "../collections/emptyCollections";
  import { getEditorWorkbenchRuntime } from "../editor/editorWorkbenchContext";
  import { getEditorToolController } from "../editor/editorToolContext";
  import type { EditorToolSnapshot } from "../editor/editorToolController";
  import { updateLiveEditorTabs, partitionImmediateAndDeferred } from "../editor/editorTabKeepAlive";

  let {
    paneId,
    isContextActive = true,
    isActivePane = false,
    session,
    documents,
    /** Editor context id — namespaces the editor host/session cache and the
     * keyed context host that owns this pane. */
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
    /** False while this context's entire editor tree is parked with display:none. */
    isContextActive?: boolean;
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

  /**
   * Text captured from the editor's main selection at the moment Find opens.
   * Used to seed the query when the selection is non-empty and single-ranged;
   * empty when there is nothing useful to seed.
   */
  let findReplaceSeedSelection = $state("");
  let prevFindReplaceOpen = false;

  // Seed the find query from a non-empty single selection when Find opens.
  // Find/go-to field state lives only on the shared controller — panels bind
  // via function bindings (M73) so inactive panes cannot clobber the query.
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
    activeViewTabKind === "version-control" && isGitIntegrationEnabled($appSettings.gitIntegration),
  );

  const documentById = $derived(getDocumentByIdMap(documents));

  const paneDocument = $derived.by(() => {
    const docId = selectedTab ? tabDocumentId(selectedTab) : null;
    if (!docId) {
      return undefined;
    }
    return documentById.get(docId);
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

  // `renderMarkdownHtml` is deliberately off: nothing reads `documentView.markdownHtml`
  // (the preview HTML reaches MarkdownEditorPane via `activePreviewHtml` below), so
  // asking for it here was a second full markdown parse per keystroke whose result was
  // thrown away.
  const documentView = $derived(deriveAppShellDocumentViewMemoized(paneDocument));

  // ---- Markdown preview content ---------------------------------------------
  // A markdown parse is proportional to document length and the render memo is keyed
  // on the content string, so rendering straight from the live buffer meant a
  // guaranteed cache miss and a full parse on every keystroke while split/preview was
  // open. The preview instead trails the buffer by a short delay.
  const PREVIEW_DEBOUNCE_MS = 120;
  let previewSource = $state<{ documentId: string; content: string } | null>(null);

  $effect(() => {
    if (!shouldRenderMarkdownPreview || !paneDocument) {
      return;
    }
    const documentId = paneDocument.id;
    const content = paneDocument.content;
    // Read without tracking: this effect writes `previewSource`, and tracking its own
    // write would re-trigger it.
    const current = untrack(() => previewSource);
    if (!current || current.documentId !== documentId) {
      previewSource = { documentId, content };
      return;
    }
    if (current.content === content) {
      return;
    }
    const timer = setTimeout(() => {
      previewSource = { documentId, content };
    }, PREVIEW_DEBOUNCE_MS);
    // Svelte runs this before the next run of the effect, which is what makes the
    // timer a trailing debounce rather than a queue of pending renders.
    return () => clearTimeout(timer);
  });

  const previewContent = $derived.by(() => {
    if (!shouldRenderMarkdownPreview || !paneDocument) {
      return null;
    }
    // Fall back to the live content when the trailing snapshot belongs to another
    // document (first render, tab switch) so the preview never shows the previous
    // document's HTML for a frame.
    return previewSource && previewSource.documentId === paneDocument.id
      ? previewSource.content
      : paneDocument.content;
  });

  const activePreviewHtml = $derived(
    previewContent === null
      ? ""
      : renderMemoizedDocumentMarkdown(
          paneDocument?.id ?? "",
          previewContent,
          paneDocument?.filePath ?? null,
        ),
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
  // A small LRU keeps recent switches CSS-only while older views are evicted
  // into the portable editor-session cache.
  const activeTabId = $derived(selectedTab?.id ?? null);
  const paneFileTabs = $derived(
    (findPane(layout, paneId)?.tabs.filter((tab) => isFileTab(tab)) ?? []) as Extract<
      TabState,
      { kind: "file" }
    >[],
  );
  const openTextEditorTabIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const tab of paneFileTabs) {
      if (isTextEditorDocumentState(documentById.get(tab.documentId))) {
        ids.add(tab.id);
      }
    }
    return ids;
  });
  let liveEditorTabIds = $state<string[]>([]);
  const desiredLiveEditorTabIds = $derived(
    updateLiveEditorTabs(liveEditorTabIds, activeTabId, openTextEditorTabIds),
  );

  /**
   * Idle-hydration of non-active keep-alive tabs.
   *
   * A cold context switch (entering a workspace outside the
   * {@link MAX_MOUNTED_EDITOR_CONTEXTS} LRU) mounts a whole editor grid — up to
   * `MAX_LIVE_EDITOR_TABS_PER_PANE × paneCount` CodeMirror views — each doing a
   * full `EditorState.create` (document parse + extension setup). To avoid
   * stalling the main thread, only the active tab mounts synchronously; sibling
   * tabs in the keep-alive LRU hydrate on `requestIdleCallback` (falling back to
   * `setTimeout(…, 0)` when idle callbacks are unavailable, e.g. in tests). If
   * the user switches to a deferred tab before it hydrates, it is promoted
   * synchronously by the active-tab immediate path.
   */
  let pendingIdleTabIds = new Set<string>();
  let idleHydrateHandle: ReturnType<typeof requestIdle> | null = null;

  function requestIdle(callback: () => void): ReturnType<typeof requestIdleCallback> | ReturnType<typeof setTimeout> {
    if (typeof requestIdleCallback === "function") {
      return requestIdleCallback(() => callback());
    }
    return setTimeout(() => callback(), 0);
  }

  function cancelIdle(handle: ReturnType<typeof requestIdle> | null): void {
    if (handle === null) {
      return;
    }
    if (typeof cancelIdleCallback === "function" && typeof handle === "number") {
      cancelIdleCallback(handle as ReturnType<typeof requestIdleCallback>);
    } else {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
  }

  function flushIdleHydrate(): void {
    idleHydrateHandle = null;
    if (pendingIdleTabIds.size === 0) {
      return;
    }
    const due = [...pendingIdleTabIds];
    pendingIdleTabIds.clear();
    // Merge the deferred tabs into the live set. Keep ordering stable relative
    // to the desired list so the LRU eviction order matches `updateLiveEditorTabs`.
    untrack(() => {
      const current = new Set(liveEditorTabIds);
      const ordered = desiredLiveEditorTabIds.filter(
        (tabId) => due.includes(tabId) || current.has(tabId),
      );
      if (
        ordered.length !== liveEditorTabIds.length ||
        ordered.some((tabId, index) => tabId !== liveEditorTabIds[index])
      ) {
        liveEditorTabIds = ordered;
      }
    });
  }

  $effect(() => {
    const next = desiredLiveEditorTabIds;
    const current = untrack(() => liveEditorTabIds);
    const { immediate, deferred } = partitionImmediateAndDeferred(
      next,
      activeTabId,
      new Set(current),
    );

    // If a previously-deferred tab is now active (or closed), drop it from the
    // pending idle set so it doesn't hydrate late and overwrite a newer state.
    const nextPending = new Set<string>();
    for (const tabId of deferred) {
      if (pendingIdleTabIds.has(tabId)) {
        nextPending.add(tabId);
      }
    }
    // New deferred entries (not yet pending) get scheduled.
    const newlyDeferred = deferred.filter((tabId) => !pendingIdleTabIds.has(tabId));
    pendingIdleTabIds = nextPending;

    const immediateSet = new Set(immediate);
    // Apply the immediate set synchronously. Preserve desired ordering.
    const orderedImmediate = next.filter((tabId) => immediateSet.has(tabId));
    if (
      orderedImmediate.length !== current.length ||
      orderedImmediate.some((tabId, index) => tabId !== current[index])
    ) {
      const mountedNewTab =
        activeTabId !== null &&
        !current.includes(activeTabId) &&
        orderedImmediate.includes(activeTabId);
      liveEditorTabIds = orderedImmediate;
      if (mountedNewTab) {
        void logPerfTiming(
          "editor tab keep-alive slot mounted",
          {
            metric: "tab.activationSideEffects",
            durationMs: 0,
            label: "editor-keepalive-mount",
            paneId,
            tabId: activeTabId,
            liveSlotCount: orderedImmediate.length,
          },
          "debug",
        );
      }
    }

    // Schedule newly-deferred tabs for idle hydration.
    if (newlyDeferred.length > 0) {
      for (const tabId of newlyDeferred) {
        pendingIdleTabIds.add(tabId);
      }
      if (idleHydrateHandle === null) {
        idleHydrateHandle = requestIdle(flushIdleHydrate);
      }
    } else if (pendingIdleTabIds.size === 0 && idleHydrateHandle !== null) {
      cancelIdle(idleHydrateHandle);
      idleHydrateHandle = null;
    }
  });

  /**
   * Entries to keep alive: recent file tabs that are still open AND still
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
    const byId = documentById;
    for (const tab of paneFileTabs) {
      if (!desiredLiveEditorTabIds.includes(tab.id)) {
        continue;
      }
      const document = byId.get(tab.documentId);
      // Cheap contentKind check — do not call deriveAppShellDocumentView here
      // (that would parse markdown HTML for every visited preview tab on each
      // documents emit, even when only filtering keep-alive eligibility).
      if (isTextEditorDocumentState(document)) {
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
          {@const entryView = deriveAppShellDocumentViewMemoized(entry.document)}
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
              markdownHtml={isEntryActive ? activePreviewHtml : ""}
              storedMarkdownViewMode={entry.document.markdownViewMode ?? "edit"}
              canFitSplit={canFitMarkdownSplit}
              {windowId}
              onStatusMessage={notify}
              {onMarkdownViewModeChange}
              {onUntitledTitleRefresh}
              {onScrollTopChange}
              visible={isContextActive && isEntryActive}
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
      bind:findQuery={
        () => toolSnapshot.find.query,
        (value) => editorTools.setFindQuery(value)
      }
      bind:replaceValue={
        () => toolSnapshot.find.replace,
        (value) => editorTools.setFindReplace(value)
      }
      bind:findCaseSensitive={
        () => toolSnapshot.find.caseSensitive,
        (value) => editorTools.setFindCaseSensitive(value)
      }
      bind:findWholeWord={
        () => toolSnapshot.find.wholeWord,
        (value) => editorTools.setFindWholeWord(value)
      }
      bind:findRegexp={
        () => toolSnapshot.find.regexp,
        (value) => editorTools.setFindRegexp(value)
      }
      seedSelection={findReplaceSeedSelection}
      getEditorRunner={getActiveEditorRunner}
      {notify}
      documentId={paneDocument?.id ?? null}
      onClose={() => editorTools.close({ restoreFocus: true })}
    />
  {/if}

  {#if isActivePane && documentView.isTextEditorDocument && !isSessionTabActive && !isChatHttpActive && goToOpen}
    <GoToLinePanel
      bind:lineValue={
        () => toolSnapshot.goToLineValue,
        (value) => editorTools.setGoToLineValue(value)
      }
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
