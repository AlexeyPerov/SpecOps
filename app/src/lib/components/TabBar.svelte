<script lang="ts">
  import { onDestroy } from "svelte";
  import type { DocumentState, TabState } from "../domain/contracts";
  import { isAgentTab, isFileTab } from "../domain/contracts";
  import { appState } from "../state/appState";
  import { chatAgentIndex } from "../state/chatStore";
  import { revealInFileManagerLabel } from "../services/platform";
  import { revealInFileManager } from "../services/revealInFileManager";
  import { readNearbyTextFiles, type NearbyTextFile } from "../services/nearbyFiles";
  import { openPath } from "../services/fileSystem";
  import { completeOpenPath, requestOpenPath } from "../services/openFileGate";
  import { runInNotepadContext, workspaceRelativePath } from "../services/workspacePaths";
  import { renameDocumentOnDisk } from "../services/documentRename";
  import { moveTabToNewWindow } from "../services/tabWindowTransfer";

  const DRAG_THRESHOLD_PX = 4;
  const revealLabel = revealInFileManagerLabel();

  export let openTabs: TabState[] = [];
  export let documents: DocumentState[] = [];
  export let selectedTabId: string | null = null;
  export let onSelect: (tabId: string) => void = (tabId: string) => appState.selectTab(tabId);
  export let onCloseTab: (tabId: string) => void = (tabId: string) => appState.closeTabForce(tabId);
  export let windowId = "main";
  export let notify: (message: string) => void = () => {};

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

  let contextMenu: { tabId: string; x: number; y: number } | null = null;
  let contextMenuEl: HTMLDivElement | null = null;
  let nearbySubmenuOpen = false;
  let nearbyFiles: NearbyTextFile[] = [];
  let nearbyFilesLoading = false;
  let nearbyRequestId = 0;

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
      return "Untitled";
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

  function openContextMenu(event: MouseEvent, tab: TabState): void {
    if (!isFileTab(tab)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
    contextMenu = { tabId: tab.id, x: event.clientX, y: event.clientY };
    nearbySubmenuOpen = false;
    window.addEventListener("pointerdown", onWindowPointerDown);
    window.addEventListener("keydown", onWindowKeydown);
    void prefetchNearbyFiles(tab);
  }

  function closeContextMenu(): void {
    if (!contextMenu) {
      return;
    }
    contextMenu = null;
    nearbySubmenuOpen = false;
    window.removeEventListener("pointerdown", onWindowPointerDown);
    window.removeEventListener("keydown", onWindowKeydown);
  }

  async function renameContextTab(): Promise<void> {
    const tabDoc = contextMenuTab ? tabDocument(contextMenuTab) : undefined;
    if (!tabDoc?.filePath) {
      closeContextMenu();
      return;
    }
    try {
      await renameDocumentOnDisk(tabDoc.id, { windowId, notify });
    } finally {
      closeContextMenu();
    }
  }

  async function revealTabInFileManager(tab: TabState): Promise<void> {
    const tabDoc = tabDocument(tab);
    if (!tabDoc?.filePath) {
      closeContextMenu();
      return;
    }
    try {
      await revealInFileManager(tabDoc.filePath);
    } catch {
      // reveal is best-effort from the tab menu
    }
    closeContextMenu();
  }

  async function copyTabPath(tab: TabState): Promise<void> {
    const tabDoc = tabDocument(tab);
    if (!tabDoc?.filePath) {
      closeContextMenu();
      return;
    }
    try {
      await navigator.clipboard.writeText(tabDoc.filePath);
    } catch {
      // clipboard is best-effort from the tab menu
    }
    closeContextMenu();
  }

  async function copyTabRelativePath(tab: TabState): Promise<void> {
    const tabDoc = tabDocument(tab);
    const workspaceRoot = appState.getWorkspaceRoot();
    if (!tabDoc?.filePath || !workspaceRoot) {
      closeContextMenu();
      return;
    }
    const relativePath = workspaceRelativePath(tabDoc.filePath, workspaceRoot);
    if (relativePath === null) {
      closeContextMenu();
      return;
    }
    try {
      await navigator.clipboard.writeText(relativePath);
    } catch {
      // clipboard is best-effort from the tab menu
    }
    closeContextMenu();
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!contextMenu) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && contextMenuEl?.contains(target)) {
      return;
    }
    closeContextMenu();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (contextMenu && event.key === "Escape") {
      closeContextMenu();
    }
  }

  function tabOpenPaths(): string[] {
    const openPaths = new Set<string>();
    for (const tab of openTabs) {
      const doc = tabDocument(tab);
      if (doc?.filePath) {
        openPaths.add(doc.filePath);
      }
    }
    return [...openPaths];
  }

  async function prefetchNearbyFiles(tab: TabState): Promise<void> {
    const tabDoc = tabDocument(tab);
    if (!tabDoc?.filePath) {
      nearbyFiles = [];
      nearbyFilesLoading = false;
      return;
    }
    nearbyFilesLoading = true;
    nearbyFiles = [];
    const requestId = nearbyRequestId + 1;
    nearbyRequestId = requestId;
    try {
      const files = await readNearbyTextFiles(tabDoc.filePath, tabOpenPaths(), 10);
      if (nearbyRequestId !== requestId) {
        return;
      }
      nearbyFiles = files;
    } catch {
      if (nearbyRequestId !== requestId) {
        return;
      }
      nearbyFiles = [];
    } finally {
      if (nearbyRequestId === requestId) {
        nearbyFilesLoading = false;
      }
    }
  }

  async function openPathWithPipeline(path: string): Promise<void> {
    try {
      const opened = await openPath(path);
      if (opened.sizeBytes > 10 * 1024 * 1024) {
        return;
      }
      const gateResult = await requestOpenPath(opened.path, windowId);
      if (gateResult.kind === "needs_read") {
        await completeOpenPath(opened.path, opened.content, windowId);
      }
    } catch {
      // nearby open is best-effort from the tab menu
    }
  }

  async function openNearbyFile(path: string): Promise<void> {
    await openPathWithPipeline(path);
    closeContextMenu();
  }

  async function openAllNearbyFiles(): Promise<void> {
    await runInNotepadContext(async () => {
      for (const nearbyFile of nearbyFiles) {
        await openPathWithPipeline(nearbyFile.path);
      }
    });
    closeContextMenu();
  }

  function closeContextTabWithPrompt(): void {
    if (!contextMenuTab) {
      return;
    }
    appState.closeTabWithPrompt(contextMenuTab.id, (message) => window.confirm(message));
    closeContextMenu();
  }

  function closeOtherTabsWithPrompt(): void {
    if (!contextMenuTab) {
      return;
    }
    appState.closeOtherTabs(contextMenuTab.id, (message) => window.confirm(message));
    closeContextMenu();
  }

  function closeTabsToRightWithPrompt(): void {
    if (!contextMenuTab) {
      return;
    }
    appState.closeTabsToRight(contextMenuTab.id, (message) => window.confirm(message));
    closeContextMenu();
  }

  function closeMissingFileTabs(): void {
    appState.closeMissingFileTabs();
    closeContextMenu();
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
    if (isAgentTab(tab)) {
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

  function isPointerOutsideTabStrip(pointerX: number, pointerY: number): boolean {
    if (!tabStripEl) {
      return false;
    }
    const stripRect = tabStripEl.getBoundingClientRect();
    const outsideStrip =
      pointerX < stripRect.left ||
      pointerX > stripRect.right ||
      pointerY < stripRect.top ||
      pointerY > stripRect.bottom;
    if (outsideStrip) {
      return true;
    }
    return (
      pointerX < 0 ||
      pointerY < 0 ||
      pointerX > document.documentElement.clientWidth ||
      pointerY > document.documentElement.clientHeight
    );
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
    const pointerX = dragPointerX;
    const pointerY = dragPointerY;
    const wasDrag = didDrag;

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

    if (commitReorder && wasDrag && activeTabId) {
      if (isPointerOutsideTabStrip(pointerX, pointerY)) {
        void moveTabToNewWindow({
          tabId: activeTabId,
          sourceWindowId: windowId,
          notify,
        }).then((transferred) => {
          if (transferred) {
            notify("Transferred tab to new window.");
          }
        });
      } else if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
        appState.reorderTabs(fromIndex, toIndex);
        onSelect(activeTabId);
      }
    } else if (!wasDrag && activeTabId) {
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
    closeContextMenu();
  });

  $: contextMenuTab = contextMenu
    ? openTabs.find((tab) => tab.id === contextMenu?.tabId) ?? null
    : null;
  $: contextMenuCanReveal = Boolean(contextMenuTab && tabDocument(contextMenuTab)?.filePath);
  $: contextMenuCanRename = Boolean(
    contextMenuTab &&
      isFileTab(contextMenuTab) &&
      contextMenuTabDoc?.filePath &&
      !contextMenuTabDoc.fileMissing,
  );
  $: contextMenuTabIndex = contextMenuTab ? openTabs.findIndex((tab) => tab.id === contextMenuTab.id) : -1;
  $: contextMenuTabDoc = contextMenuTab ? tabDocument(contextMenuTab) : null;
  $: contextMenuWorkspaceRoot = appState.getWorkspaceRoot();
  $: contextMenuRelativePath =
    contextMenuTabDoc?.filePath && contextMenuWorkspaceRoot
      ? workspaceRelativePath(contextMenuTabDoc.filePath, contextMenuWorkspaceRoot)
      : null;
  $: contextMenuCanCloseOtherTabs = Boolean(
    contextMenuTab &&
      openTabs.some((tab) => tab.id !== contextMenuTab.id && !tab.pinned),
  );
  $: contextMenuCanCloseTabsToRight =
    contextMenuTabIndex >= 0 &&
    openTabs.slice(contextMenuTabIndex + 1).some((tab) => !tab.pinned);
  $: contextMenuCanCloseMissingFileTabs = openTabs.some((tab) => {
    if (tab.pinned) {
      return false;
    }
    return Boolean(tabDocument(tab)?.fileMissing);
  });
  $: contextMenuCanOpenNearby = Boolean(contextMenuTabDoc?.filePath);
  $: contextMenuCanCopyPath = Boolean(contextMenuTabDoc?.filePath);
  $: contextMenuCanCopyRelativePath = contextMenuRelativePath !== null;
  $: contextMenuHasNearbyFiles = nearbyFiles.length > 0;
</script>

<div class="tab-strip" bind:this={tabStripEl} data-dragging={didDrag}>
  {#each tabsForRender as tab (tab.id)}
    {#if didDrag && tab.id === dragTabId}
      <span class="tab-placeholder" style={`width:${dragTabRect?.width ?? 0}px`}></span>
    {:else}
      <div class={`tab-shell ${isAgentTab(tab) ? "tab-shell-agent" : ""}`}>
        <button
          class={`tab ${isAgentTab(tab) ? "tab-agent" : ""} ${tab.id === selectedTabId ? "tab-active" : ""}`}
          data-tab-id={tab.id}
          type="button"
          title={tabTooltip(tab)}
          oncontextmenu={(event) => openContextMenu(event, tab)}
          onpointerdown={(event) => {
            if (isAgentTab(tab)) {
              if (event.button === 0) {
                onSelect(tab.id);
              }
              return;
            }
            pointerDown(event, tab, openTabs.findIndex((entry) => entry.id === tab.id));
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

{#if didDrag && dragTabId}
  <button
    class={`tab tab-dragging ${draggedTab && isAgentTab(draggedTab) ? "tab-agent" : ""} ${dragTabId === selectedTabId ? "tab-active" : ""}`}
    type="button"
    style={`left:${dragPointerX - dragOffsetX}px; top:${dragPointerY - dragOffsetY}px; width:${dragTabRect?.width ?? 0}px; height:${dragTabRect?.height ?? 0}px;`}
  >
    {#if draggedTab}
      {tabTitle(draggedTab)}
    {/if}
  </button>
{/if}

{#if contextMenu && contextMenuTab}
  <div
    bind:this={contextMenuEl}
    class="tab-context-menu"
    style={`left:${contextMenu.x}px; top:${contextMenu.y}px;`}
    role="menu"
    tabindex="-1"
    onpointerdown={(event) => event.stopPropagation()}
  >
    <button
      class="tab-context-item"
      type="button"
      role="menuitem"
      onpointerdown={(event) => {
        event.stopPropagation();
        closeContextTabWithPrompt();
      }}
    >
      Close Tab
    </button>
    <button
      class="tab-context-item"
      type="button"
      role="menuitem"
      disabled={!contextMenuCanCloseOtherTabs}
      onpointerdown={(event) => {
        event.stopPropagation();
        if (!contextMenuCanCloseOtherTabs) {
          return;
        }
        closeOtherTabsWithPrompt();
      }}
    >
      Close Other Tabs
    </button>

    <div class="tab-context-separator" role="separator"></div>

    <button
      class="tab-context-item"
      type="button"
      role="menuitem"
      disabled={!contextMenuCanCloseTabsToRight}
      onpointerdown={(event) => {
        event.stopPropagation();
        if (!contextMenuCanCloseTabsToRight) {
          return;
        }
        closeTabsToRightWithPrompt();
      }}
    >
      Close Tabs to the Right
    </button>
    <button
      class="tab-context-item"
      type="button"
      role="menuitem"
      disabled={!contextMenuCanCloseMissingFileTabs}
      onpointerdown={(event) => {
        event.stopPropagation();
        if (!contextMenuCanCloseMissingFileTabs) {
          return;
        }
        closeMissingFileTabs();
      }}
    >
      Close Missing File Tabs
    </button>

    <div class="tab-context-separator" role="separator"></div>

    <div
      class="tab-context-submenu"
      role="none"
      onpointerenter={() => {
        if (!contextMenuCanOpenNearby) {
          return;
        }
        nearbySubmenuOpen = true;
      }}
      onpointerleave={() => {
        nearbySubmenuOpen = false;
      }}
      onfocusin={() => {
        if (!contextMenuCanOpenNearby) {
          return;
        }
        nearbySubmenuOpen = true;
      }}
      onfocusout={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !contextMenuEl?.contains(nextTarget)) {
          nearbySubmenuOpen = false;
        }
      }}
    >
      <button
        class="tab-context-item tab-context-item-submenu"
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={nearbySubmenuOpen}
        disabled={!contextMenuCanOpenNearby}
        onpointerdown={(event) => {
          event.stopPropagation();
          if (!contextMenuCanOpenNearby) {
            return;
          }
          nearbySubmenuOpen = true;
        }}
      >
        <span>Open Nearby</span>
        <span class="tab-context-chevron">›</span>
      </button>
      {#if nearbySubmenuOpen && contextMenuCanOpenNearby}
        <div class="tab-context-submenu-panel" role="menu">
          {#if nearbyFilesLoading}
            <button class="tab-context-item" type="button" role="menuitem" disabled>Loading...</button>
          {:else if !contextMenuHasNearbyFiles}
            <button class="tab-context-item" type="button" role="menuitem" disabled>
              No nearby files
            </button>
          {:else}
            {#each nearbyFiles as nearbyFile (nearbyFile.path)}
              <button
                class="tab-context-item"
                type="button"
                role="menuitem"
                onpointerdown={(event) => {
                  event.stopPropagation();
                  void openNearbyFile(nearbyFile.path);
                }}
              >
                {nearbyFile.basename}
              </button>
            {/each}
          {/if}

          <div class="tab-context-separator" role="separator"></div>

          <button
            class="tab-context-item"
            type="button"
            role="menuitem"
            disabled={!contextMenuHasNearbyFiles}
            onpointerdown={(event) => {
              event.stopPropagation();
              if (!contextMenuHasNearbyFiles) {
                return;
              }
              void openAllNearbyFiles();
            }}
          >
            Open All Nearby
          </button>
        </div>
      {/if}
    </div>

    <div class="tab-context-separator" role="separator"></div>

    <button
      class="tab-context-item"
      type="button"
      role="menuitem"
      disabled={!contextMenuCanCopyPath}
      onpointerdown={(event) => {
        event.stopPropagation();
        if (!contextMenuCanCopyPath || !contextMenuTab) {
          return;
        }
        void copyTabPath(contextMenuTab);
      }}
    >
      Copy Path
    </button>
    {#if contextMenuWorkspaceRoot}
      <button
        class="tab-context-item"
        type="button"
        role="menuitem"
        disabled={!contextMenuCanCopyRelativePath}
        onpointerdown={(event) => {
          event.stopPropagation();
          if (!contextMenuCanCopyRelativePath || !contextMenuTab) {
            return;
          }
          void copyTabRelativePath(contextMenuTab);
        }}
      >
        Copy Relative Path
      </button>
    {/if}

    {#if contextMenuCanRename}
      <div class="tab-context-separator" role="separator"></div>

      <button
        class="tab-context-item"
        type="button"
        role="menuitem"
        onpointerdown={(event) => {
          event.stopPropagation();
          void renameContextTab();
        }}
      >
        Rename
      </button>
    {/if}

    <div class="tab-context-separator" role="separator"></div>

    <button
      class="tab-context-item"
      type="button"
      role="menuitem"
      disabled={!contextMenuCanReveal}
      onpointerdown={(event) => {
        event.stopPropagation();
        if (!contextMenuCanReveal) {
          return;
        }
        void revealTabInFileManager(contextMenuTab);
      }}
    >
      {revealLabel}
    </button>
  </div>
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

  .tab-context-menu {
    position: fixed;
    z-index: 1100;
    min-width: 180px;
    padding: var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-overlay);
  }

  .tab-context-item {
    display: block;
    width: 100%;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    text-align: left;
    font: inherit;
    padding: var(--space-4) var(--space-6);
  }

  .tab-context-item-submenu {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
  }

  .tab-context-chevron {
    color: var(--color-text-secondary);
  }

  .tab-context-separator {
    height: 1px;
    margin: var(--space-4) var(--space-2);
    background: var(--color-border-subtle);
  }

  .tab-context-submenu {
    position: relative;
  }

  .tab-context-submenu-panel {
    position: absolute;
    top: 0;
    left: calc(100% + var(--space-4));
    z-index: 1;
    min-width: 180px;
    padding: var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-overlay);
  }

  .tab-context-item:not(:disabled):hover {
    background: var(--color-hover);
    cursor: pointer;
  }

  .tab-context-item:disabled {
    color: var(--color-text-secondary);
    cursor: not-allowed;
  }
</style>
