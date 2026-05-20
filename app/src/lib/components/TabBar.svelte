<script lang="ts">
  import { onDestroy } from "svelte";
  import type { DocumentState, TabState } from "../domain/contracts";
  import { appState } from "../state/appState";

  const DRAG_THRESHOLD_PX = 4;

  export let openTabs: TabState[] = [];
  export let documents: DocumentState[] = [];
  export let selectedTabId: string | null = null;
  export let onSelect: (tabId: string) => void = (tabId: string) => appState.selectTab(tabId);

  let tabStripEl: HTMLDivElement | null = null;

  let pointerId: number | null = null;
  let pressedTabId: string | null = null;
  let dragTabId: string | null = null;
  let dragFromIndex = -1;
  let dropIndex = -1;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragPointerX = 0;
  let dragPointerY = 0;
  let dragPointerStartX = 0;
  let dragTabRect: DOMRect | null = null;
  let tabRects = new Map<string, DOMRect>();
  let didDrag = false;

  let isFinishingDrag = false;

  function tabTitle(tab: TabState): string {
    const tabDoc = documents.find((doc) => doc.id === tab.documentId);
    if (!tabDoc) {
      return "Untitled";
    }
    return `${tabDoc.title}${tabDoc.isDirty ? "*" : ""}`;
  }

  function previewTabs(
    sourceTabs: TabState[],
    isDragging: boolean,
    sourceIndex: number,
    targetIndex: number,
  ): TabState[] {
    if (!isDragging || sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      return sourceTabs;
    }
    const next = [...sourceTabs];
    const [moved] = next.splice(sourceIndex, 1);
    if (!moved) {
      return sourceTabs;
    }
    next.splice(targetIndex, 0, moved);
    return next;
  }

  $: tabsForRender = previewTabs(openTabs, didDrag, dragFromIndex, dropIndex);
  $: draggedTab = dragTabId ? openTabs.find((tab) => tab.id === dragTabId) ?? null : null;

  function pointerDown(event: PointerEvent, tab: TabState, index: number): void {
    if (event.button !== 0 || isFinishingDrag) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
      return;
    }

    pointerId = event.pointerId;
    pressedTabId = tab.id;
    dragTabId = tab.id;
    dragFromIndex = index;
    dropIndex = index;
    dragPointerStartX = event.clientX;
    dragPointerX = event.clientX;
    dragPointerY = event.clientY;
    dragTabRect = target.getBoundingClientRect();
    dragOffsetX = event.clientX - dragTabRect.left;
    dragOffsetY = event.clientY - dragTabRect.top;
    didDrag = false;

    collectTabRects();
    target.setPointerCapture(event.pointerId);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  function collectTabRects(): void {
    const next = new Map<string, DOMRect>();
    if (!tabStripEl) {
      tabRects = next;
      return;
    }
    for (const node of tabStripEl.querySelectorAll<HTMLElement>("[data-tab-id]")) {
      const tabId = node.dataset.tabId;
      if (!tabId) {
        continue;
      }
      next.set(tabId, node.getBoundingClientRect());
    }
    tabRects = next;
  }

  function nextDropIndex(pointerX: number): number {
    const tabsWithoutDragged = openTabs.filter((tab) => tab.id !== dragTabId);
    if (tabsWithoutDragged.length === 0) {
      return dragFromIndex;
    }

    for (let i = 0; i < tabsWithoutDragged.length; i += 1) {
      const tab = tabsWithoutDragged[i];
      const rect = tabRects.get(tab.id);
      if (!rect) {
        continue;
      }
      const midpoint = rect.left + rect.width / 2;
      if (pointerX < midpoint) {
        return i;
      }
    }
    return tabsWithoutDragged.length;
  }

  function onPointerMove(event: PointerEvent): void {
    if (pointerId === null || event.pointerId !== pointerId || !dragTabRect || !dragTabId) {
      return;
    }

    dragPointerX = event.clientX;
    dragPointerY = event.clientY;

    const distance = Math.abs(event.clientX - dragPointerStartX);
    if (!didDrag && distance < DRAG_THRESHOLD_PX) {
      return;
    }

    didDrag = true;
    collectTabRects();
    dropIndex = nextDropIndex(event.clientX);
  }

  function finishDrag(commitReorder: boolean): void {
    if (isFinishingDrag) {
      return;
    }
    isFinishingDrag = true;
    const activePointerId = pointerId;
    const fromIndex = dragFromIndex;
    const toIndex = dropIndex;
    const activeTabId = dragTabId;

    pointerId = null;
    pressedTabId = null;
    dragTabId = null;
    dragFromIndex = -1;
    dropIndex = -1;
    dragOffsetX = 0;
    dragOffsetY = 0;
    dragPointerStartX = 0;
    dragTabRect = null;
    tabRects = new Map();

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    if (activePointerId !== null) {
      for (const node of tabStripEl?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? []) {
        if (node.hasPointerCapture(activePointerId)) {
          node.releasePointerCapture(activePointerId);
        }
      }
    }

    if (commitReorder && didDrag && fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
      appState.reorderTabs(fromIndex, toIndex);
      if (activeTabId) {
        onSelect(activeTabId);
      }
    } else if (!didDrag && activeTabId) {
      onSelect(activeTabId);
    }

    didDrag = false;
    isFinishingDrag = false;
  }

  function onPointerUp(event: PointerEvent): void {
    if (pointerId === null || event.pointerId !== pointerId) {
      return;
    }
    finishDrag(true);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (pointerId === null || event.pointerId !== pointerId) {
      return;
    }
    finishDrag(false);
  }

  onDestroy(() => {
    finishDrag(false);
  });
</script>

<div class="tab-strip" bind:this={tabStripEl} data-dragging={didDrag}>
  {#each tabsForRender as tab (tab.id)}
    {#if didDrag && tab.id === dragTabId}
      <span class="tab-placeholder" style={`width:${dragTabRect?.width ?? 0}px`}></span>
    {:else}
      <div class="tab-shell">
        <button
          class={`tab ${tab.id === selectedTabId ? "tab-active" : ""}`}
          data-tab-id={tab.id}
          type="button"
          onpointerdown={(event) => pointerDown(event, tab, openTabs.findIndex((entry) => entry.id === tab.id))}
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
            appState.closeTabForce(tab.id);
          }}
        >
          ×
        </button>
      </div>
    {/if}
  {/each}
</div>

{#if didDrag && dragTabId}
  <button
    class={`tab tab-dragging ${dragTabId === selectedTabId ? "tab-active" : ""}`}
    type="button"
    style={`left:${dragPointerX - dragOffsetX}px; top:${dragPointerY - dragOffsetY}px; width:${dragTabRect?.width ?? 0}px; height:${dragTabRect?.height ?? 0}px;`}
  >
    {#if draggedTab}
      {tabTitle(draggedTab)}
    {/if}
  </button>
{/if}

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
