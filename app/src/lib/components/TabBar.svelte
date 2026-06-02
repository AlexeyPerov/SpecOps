<script lang="ts">
  import { onDestroy } from "svelte";
  import type { DocumentState, TabState } from "../domain/contracts";
  import { isAgentTab, isFileTab } from "../domain/contracts";
  import { appState } from "../state/appState";
  import { chatAgentIndex } from "../state/chatStore";
  import { DEFAULT_UNTITLED_TITLE } from "../services/untitledTitle";
  import TabBarContextMenu from "./TabBarContextMenu.svelte";
  import {
    createTabDragController,
    previewTabs,
    type TabDragState,
  } from "./tabDragController";

  export let openTabs: TabState[] = [];
  export let documents: DocumentState[] = [];
  export let selectedTabId: string | null = null;
  export let onSelect: (tabId: string) => void = (tabId: string) => appState.selectTab(tabId);
  export let onCloseTab: (tabId: string) => void = (tabId: string) => appState.closeTabForce(tabId);
  export let windowId = "main";
  export let notify: (message: string) => void = () => {};

  let tabStripEl: HTMLDivElement | null = null;
  let contextMenuComponent: TabBarContextMenu;

  let dragState: TabDragState = {
    pointerId: null,
    pressedTabId: null,
    dragTabId: null,
    dragFromIndex: -1,
    dropIndex: -1,
    dragOffsetX: 0,
    dragOffsetY: 0,
    dragPointerX: 0,
    dragPointerY: 0,
    dragPointerStartX: 0,
    dragTabRect: null,
    tabRects: new Map(),
    didDrag: false,
    isFinishingDrag: false,
  };

  const dragController = createTabDragController({
    getOpenTabs: () => openTabs,
    getTabStripEl: () => tabStripEl,
    onSelect,
    onReorder: (fromIndex, toIndex) => appState.reorderTabs(fromIndex, toIndex),
    getWindowId: () => windowId,
    notify,
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

  $: agentTitleById = new Map($chatAgentIndex.map((entry) => [entry.id, entry.title]));

  function tabTitle(tab: TabState): string {
    if (isAgentTab(tab)) {
      return agentTitleById.get(tab.agentId) ?? "New agent";
    }
    const tabDoc = tabDocument(tab);
    if (!tabDoc) {
      return DEFAULT_UNTITLED_TITLE;
    }
    const missingSuffix = tabDoc.fileMissing ? " (missing)" : "";
    return `${tabDoc.title}${tabDoc.isDirty ? "*" : ""}${missingSuffix}`;
  }

  function tabTooltip(tab: TabState): string {
    if (isAgentTab(tab)) {
      return "Agent chat";
    }
    const tabDoc = tabDocument(tab);
    if (!tabDoc?.filePath) {
      return "Unsaved document";
    }
    return tabDoc.filePath;
  }

  $: tabsForRender = previewTabs(
    openTabs,
    dragState.didDrag,
    dragState.dragFromIndex,
    dragState.dropIndex,
  );
  $: draggedTab = dragState.dragTabId
    ? openTabs.find((tab) => tab.id === dragState.dragTabId) ?? null
    : null;

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
      <div class={`tab-shell ${isAgentTab(tab) ? "tab-shell-agent" : ""}`}>
        <button
          class={`tab ${isAgentTab(tab) ? "tab-agent" : ""} ${tab.id === selectedTabId ? "tab-active" : ""}`}
          data-tab-id={tab.id}
          type="button"
          title={tabTooltip(tab)}
          oncontextmenu={(event) => contextMenuComponent.openContextMenu(event, tab)}
          onpointerdown={(event) => {
            if (isAgentTab(tab)) {
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
    class={`tab tab-dragging ${draggedTab && isAgentTab(draggedTab) ? "tab-agent" : ""} ${dragState.dragTabId === selectedTabId ? "tab-active" : ""}`}
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
    gap: var(--space-6);
    min-width: 0;
    overflow: hidden;
  }

  .tab-strip[data-dragging="true"] {
    user-select: none;
  }

  .tab-shell {
    position: relative;
    height: calc(var(--tab-header-height) - var(--space-8));
    min-width: 0;
  }

  .tab {
    display: flex;
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    height: calc(var(--tab-header-height) - var(--space-8));
    padding: 0 var(--space-8) 0 var(--space-6);
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

  .tab-agent {
    border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }

  .tab-agent.tab-active {
    background: color-mix(in srgb, var(--color-accent) 20%, var(--color-hover));
    border-color: color-mix(in srgb, var(--color-accent) 62%, var(--color-border-subtle));
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
    height: calc(var(--tab-header-height) - var(--space-8));
  }

  .tab-dragging {
    position: fixed;
    z-index: 1000;
    pointer-events: none;
    cursor: grabbing;
    box-shadow: var(--shadow-overlay);
  }
</style>
