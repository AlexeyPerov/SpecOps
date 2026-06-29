<script lang="ts">
  import { onDestroy } from "svelte";
  import type { DocumentState, TabState } from "../domain/contracts";
  import { isFileTab, isSessionTab, isViewTab } from "../domain/contracts";
  import { appState } from "../state/appState";
  import { chatSessionIndex } from "../state/chatStore";
  import { draftEntryTitleForScope } from "../services/chatSessions";
  import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
  import { DEFAULT_UNTITLED_TITLE } from "../services/untitledTitle";
  import TabBarContextMenu from "./TabBarContextMenu.svelte";
  import {
    createTabDragController,
    previewTabs,
    type TabDragState,
  } from "./tabDragController";
  import type { PaneDropTargetElements } from "./paneDropTargets";

  interface Props {
    openTabs?: TabState[];
    documents?: DocumentState[];
    selectedTabId?: string | null;
    useChatTerminology?: boolean;
    onSelect?: (tabId: string) => void;
    onCloseTab?: (tabId: string) => void;
    windowId?: string;
    notify?: (message: string) => void;
    /**
     * Phase 5 — this strip's pane id. When set together with `getPaneElements`
     * and `onMoveBetweenPanes`, the drag controller hit-tests every pane and
     * can move the tab across panes. Defaults keep TabBar working in any
     * single-pane / non-split call site.
     */
    paneId?: string;
    getPaneElements?: () => PaneDropTargetElements[];
    onMoveBetweenPanes?: (
      fromPaneId: string,
      tabId: string,
      toPaneId: string,
      toIndex: number,
    ) => void;
    onDropTargetChange?: (paneId: string | null) => void;
  }

  let {
    openTabs = [],
    documents = [],
    selectedTabId = null,
    useChatTerminology = false,
    onSelect = (tabId: string) => appState.selectTab(tabId),
    onCloseTab = (tabId: string) => appState.closeTabForce(tabId),
    windowId = "main",
    notify = () => {},
    paneId = "",
    getPaneElements = () => [],
    onMoveBetweenPanes,
    onDropTargetChange = () => {},
  }: Props = $props();

  let tabStripEl = $state<HTMLDivElement | null>(null);
  let contextMenuComponent = $state<TabBarContextMenu | undefined>(undefined);

  let dragState = $state<TabDragState>({
    pointerId: null,
    pressedTabId: null,
    dragTabId: null,
    dragFromIndex: -1,
    dropIndex: -1,
    dropPaneId: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
    dragPointerX: 0,
    dragPointerY: 0,
    dragPointerStartX: 0,
    dragPointerStartY: 0,
    dragPointerScreenX: 0,
    dragPointerScreenY: 0,
    dragTabRect: null,
    tabRects: new Map(),
    didDrag: false,
    isFinishingDrag: false,
  });

  // Lift the drop-target pane id to the parent grid so the hovered pane can
  // render an affordance. Only reports a *cross-pane* target (null otherwise),
  // so the parent doesn't highlight the source pane.
  $effect(() => {
    const target = dragState.didDrag ? dragState.dropPaneId : null;
    if (target && target !== paneId) {
      onDropTargetChange(target);
    } else if (!target) {
      onDropTargetChange(null);
    }
  });

  const dragController = createTabDragController({
    getOpenTabs: () => openTabs,
    getTabStripEl: () => tabStripEl,
    getPaneId: () => paneId,
    getPaneElements: () => getPaneElements(),
    onSelect: (tabId) => onSelect(tabId),
    onReorder: (fromIndex, toIndex) => appState.reorderTabs(fromIndex, toIndex),
    onMoveBetweenPanes: (fromPaneId, tabId, toPaneId, toIndex) =>
      onMoveBetweenPanes?.(fromPaneId, tabId, toPaneId, toIndex),
    getWindowId: () => windowId,
    notify: (message) => notify(message),
    onStateChange: (nextState) => {
      dragState = nextState;
    },
  });

  function tabDocument(tab: TabState): DocumentState | undefined {
    if (!isFileTab(tab)) {
      return undefined;
    }
    return documents.find((doc) => doc.id === tab.documentId);
  }

  const sessionTitleById = $derived(new Map($chatSessionIndex.map((entry) => [entry.id, entry.title])));

  const draftTabTitle = $derived(
    draftEntryTitleForScope(useChatTerminology ? CHAT_HTTP_CONTEXT_ID : null),
  );

  function tabTitle(tab: TabState): string {
    if (isSessionTab(tab)) {
      return sessionTitleById.get(tab.sessionId) ?? draftTabTitle;
    }
    if (isViewTab(tab)) {
      return tab.view === "settings" ? "Settings" : "Themes";
    }
    const tabDoc = tabDocument(tab);
    if (!tabDoc) {
      return DEFAULT_UNTITLED_TITLE;
    }
    const missingSuffix = tabDoc.fileMissing ? " (missing)" : "";
    return `${tabDoc.title}${tabDoc.isDirty ? "*" : ""}${missingSuffix}`;
  }

  function tabTooltip(tab: TabState): string {
    if (isSessionTab(tab)) {
      return useChatTerminology ? "Chat" : "Session";
    }
    if (isViewTab(tab)) {
      return tab.view === "settings" ? "Settings" : "Themes";
    }
    const tabDoc = tabDocument(tab);
    if (!tabDoc?.filePath) {
      return "Unsaved document";
    }
    return tabDoc.filePath;
  }

  const tabsForRender = $derived(
    previewTabs(
      openTabs,
      dragState.didDrag,
      dragState.dragFromIndex,
      dragState.dropIndex,
    ),
  );

  const draggedTab = $derived(
    dragState.dragTabId
      ? (openTabs.find((tab) => tab.id === dragState.dragTabId) ?? null)
      : null,
  );

  onDestroy(() => {
    dragController.destroy();
    contextMenuComponent?.closeContextMenu();
  });
</script>

<div class="tab-strip" bind:this={tabStripEl} data-dragging={dragState.didDrag}>
  {#each tabsForRender as tab (tab.id)}
    {#if dragState.didDrag && tab.id === dragState.dragTabId}
      <span class="tab-placeholder" style={`width:${dragState.dragTabRect?.width ?? 0}px`}></span>
    {:else}
      <div class="tab-shell">
        <button
          class={`tab ${tab.id === selectedTabId ? "tab-active" : ""}`}
          data-tab-id={tab.id}
          type="button"
          title={tabTooltip(tab)}
          oncontextmenu={(event) => contextMenuComponent?.openContextMenu(event, tab)}
          onpointerdown={(event) => {
            if (isSessionTab(tab)) {
              if (event.button === 0) {
                onSelect(tab.id);
              }
              return;
            }
            dragController.pointerDown(event, tab, openTabs.findIndex((entry) => entry.id === tab.id));
          }}
        >
          <span class="tab-label">
            {tabTitle(tab)}
          </span>
        </button>
        <button
          class="tab-close"
          type="button"
          aria-label={`Close ${tabTitle(tab)}`}
          title="Close tab"
          onpointerdown={(event) => {
            event.stopPropagation();
          }}
          onclick={(event) => {
            event.stopPropagation();
            onCloseTab(tab.id);
          }}
        >
          ×
        </button>
      </div>
    {/if}
  {/each}
</div>

{#if dragState.didDrag && dragState.dragTabId}
  <button
    class={`tab tab-dragging ${dragState.dragTabId === selectedTabId ? "tab-active" : ""}`}
    type="button"
    style={`left:${dragState.dragPointerX - dragState.dragOffsetX}px; top:${dragState.dragPointerY - dragState.dragOffsetY}px; width:${dragState.dragTabRect?.width ?? 0}px; height:${dragState.dragTabRect?.height ?? 0}px;`}
  >
    {#if draggedTab}
      {tabTitle(draggedTab)}
    {/if}
  </button>
{/if}

<TabBarContextMenu
  bind:this={contextMenuComponent}
  {openTabs}
  {documents}
  {windowId}
  {notify}
/>

<style>
  .tab-strip {
    display: flex;
    align-items: center;
    /* Inter-tab gap is load-bearing relative to the tab vertical inset
       (tab height = --tab-header-height - 8px); keep both as literal px so the
       M11-T1 spacing-scale change doesn't shrink the tabs. */
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }

  .tab-strip[data-dragging="true"] {
    user-select: none;
  }

  .tab-shell {
    position: relative;
    height: calc(var(--tab-header-height) - 8px);
    min-width: 0;
  }

  .tab {
    display: flex;
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    height: calc(var(--tab-header-height) - 8px);
    /* Horizontal tab padding is load-bearing; literal px keeps the tab geometry
       stable across the M11-T1 spacing-scale change. */
    padding: 0 8px 0 6px;
    min-width: 0;
    width: 100%;
  }

  .tab-label {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    font: inherit;
    padding: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-right: 16px;
    pointer-events: none;
  }

  .tab-close {
    position: absolute;
    top: 2px;
    right: 4px;
    width: 14px;
    height: 14px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 12px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      border-color var(--motion-fast) var(--easing-standard);
  }

  .tab-active {
    background: var(--color-hover);
    border-color: var(--color-border-subtle);
  }

  .tab:hover {
    background: var(--color-hover);
    cursor: pointer;
  }

  .tab-shell:hover .tab-close {
    color: inherit;
  }

  .tab-close:hover {
    background: var(--color-pressed);
    cursor: pointer;
  }

  .tab:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .tab:active {
    background: var(--color-pressed);
  }

  .tab-placeholder {
    flex-shrink: 0;
    height: calc(var(--tab-header-height) - 8px);
  }

  .tab-dragging {
    position: fixed;
    z-index: 1000;
    pointer-events: none;
    cursor: grabbing;
    box-shadow: var(--shadow-overlay);
  }
</style>
