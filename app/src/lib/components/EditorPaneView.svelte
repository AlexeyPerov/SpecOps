<script lang="ts">
  import { onDestroy } from "svelte";
  import TabBar from "./TabBar.svelte";
  import type { DocumentState, TabState } from "../domain/contracts";
  import type { PaneDropTargetElements } from "./paneDropTargets";

  /**
   * One pane inside the editor grid (split view). Owns a tab strip scoped to
   * this pane's tabs and renders the editor surface for the pane's selected
   * tab. The active pane (per `layout.activePaneId`) carries the live editor
   * chrome — non-active panes show a lightweight placeholder until per-pane
   * editor wiring lands (Phase 4).
   *
   * The × close button is hidden only when a single pane remains; it is always
   * visible on empty panes (F3). Clicking anywhere in the pane focuses it.
   *
   * Phase 5/6 — registers its strip + body elements with the parent grid (for
   * cross-pane DnD hit-testing) and renders a drop affordance when this pane is
   * the active tab or file drop target.
   */
  let {
    paneId,
    tabs,
    selectedTabId,
    documents,
    isActive = false,
    canClose = false,
    useChatTerminology = false,
    windowId,
    notify,
    onSelectTab,
    onCloseTab,
    onClosePane,
    onFocus,
    onRegisterElements,
    onUnregisterElements,
    getPaneElements,
    tabDropTargetPaneId = null,
    fileDropTargetPaneId = null,
    onTabDropTargetChange,
    onMoveTabBetweenPanes,
    onOpenFileInPane,
    children,
  }: {
    paneId: string;
    tabs: TabState[];
    selectedTabId: string | null;
    documents: DocumentState[];
    isActive: boolean;
    canClose: boolean;
    useChatTerminology: boolean;
    windowId: string;
    notify: (message: string) => void;
    onSelectTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void | Promise<void>;
    onClosePane: (paneId: string) => void;
    onFocus: (paneId: string) => void;
    onRegisterElements: (
      paneId: string,
      elements: { stripEl: HTMLElement | null; bodyEl: HTMLElement | null },
    ) => void;
    onUnregisterElements: (paneId: string) => void;
    getPaneElements: () => PaneDropTargetElements[];
    tabDropTargetPaneId: string | null;
    fileDropTargetPaneId: string | null;
    onTabDropTargetChange: (paneId: string | null) => void;
    onMoveTabBetweenPanes: (
      fromPaneId: string,
      tabId: string,
      toPaneId: string,
      toIndex: number,
    ) => void;
    onOpenFileInPane: (filePath: string, paneId: string) => void | Promise<void>;
    children?: import("svelte").Snippet;
  } = $props();

  let tabStripEl = $state<HTMLDivElement | null>(null);
  let paneBodyEl = $state<HTMLDivElement | null>(null);

  const selectedTab = $derived(tabs.find((tab) => tab.id === selectedTabId) ?? null);
  const selectedDocument = $derived(
    selectedTab && selectedTab.kind === "file"
      ? (documents.find((doc) => doc.id === selectedTab.documentId) ?? null)
      : null,
  );
  const label = $derived.by(() => {
    if (!selectedTab) {
      return "No tab";
    }
    if (selectedTab.kind === "session") {
      return "Session";
    }
    if (selectedTab.kind === "view") {
      return selectedTab.view === "settings" ? "Settings" : "Themes";
    }
    return selectedDocument?.title ?? "Untitled";
  });

  const isTabDropTarget = $derived(tabDropTargetPaneId === paneId);
  const isFileDropTarget = $derived(fileDropTargetPaneId === paneId);

  // Register/unregister our elements with the parent grid so the cross-pane
  // hit-tester can see this pane's strip + body. Re-registers when the bound
  // elements change (mount/unmount).
  $effect(() => {
    onRegisterElements(paneId, { stripEl: tabStripEl, bodyEl: paneBodyEl });
  });
  onDestroy(() => {
    onUnregisterElements(paneId);
  });
</script>

<section
  class="editor-pane-view"
  class:editor-pane-view-active={isActive}
  class:pane-drop-target={isTabDropTarget || isFileDropTarget}
  data-pane-id={paneId}
  onpointerdown={() => onFocus(paneId)}
>
  <header class="pane-header" data-pane-strip={paneId}>
    <div class="pane-tab-bar" bind:this={tabStripEl}>
      <TabBar
        openTabs={tabs}
        {documents}
        {selectedTabId}
        {useChatTerminology}
        {windowId}
        {notify}
        {paneId}
        {getPaneElements}
        onSelect={(tabId) => onSelectTab(tabId)}
        onCloseTab={(tabId) => onCloseTab(tabId)}
        onMoveBetweenPanes={onMoveTabBetweenPanes}
        onDropTargetChange={onTabDropTargetChange}
      />
    </div>
    {#if canClose}
      <button
        class="toolbar-button pane-close-button"
        type="button"
        aria-label="Close pane"
        title="Close pane"
        onpointerdown={(event) => {
          event.stopPropagation();
          onClosePane(paneId);
        }}
      >
        ×
      </button>
    {/if}
  </header>

  <div class="pane-body" data-pane-body={paneId} bind:this={paneBodyEl}>
    {#if isActive}
      {@render children?.()}
    {:else if tabs.length === 0}
      <div class="pane-empty">Drop a file or tab here</div>
    {:else}
      <div class="pane-placeholder">
        <span class="pane-placeholder-label">{label}</span>
      </div>
    {/if}
  </div>
</section>

<style>
  .editor-pane-view {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: 4px;
  }
  .editor-pane-view-active {
    border-color: var(--accent-color, #3b82f6);
    box-shadow: 0 0 0 1px var(--accent-color, #3b82f6) inset;
  }
  .pane-drop-target {
    outline: 2px dashed var(--accent-color, #3b82f6);
    outline-offset: -2px;
    background: color-mix(in srgb, var(--accent-color, #3b82f6) 8%, transparent);
  }
  .pane-header {
    display: flex;
    align-items: stretch;
    gap: 2px;
    min-height: var(--tab-header-height, 32px);
    border-bottom: 1px solid var(--pane-border-color, rgba(128, 128, 128, 0.2));
  }
  .pane-tab-bar {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
  }
  .pane-close-button {
    flex: 0 0 auto;
    align-self: center;
    margin-right: 4px;
    line-height: 1;
    font-size: 16px;
    padding: 2px 6px;
  }
  .pane-body {
    flex: 1 1 auto;
    min-height: 0;
    position: relative;
    display: flex;
  }
  .pane-empty {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--pane-empty-color, rgba(128, 128, 128, 0.7));
    font-size: 13px;
    user-select: none;
  }
  .pane-placeholder {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--pane-empty-color, rgba(128, 128, 128, 0.7));
    background: var(--pane-placeholder-bg, rgba(128, 128, 128, 0.04));
    font-size: 13px;
    user-select: none;
  }
</style>
