<script lang="ts">
  import type { DocumentState, TabState } from "../domain/contracts";
  import { isFileTab } from "../domain/contracts";
  import { appState } from "../state/appState";
  import { revealInFileManagerLabel } from "../services/platform";
  import { revealInFileManager } from "../services/revealInFileManager";
  import { readNearbyTextFiles, type NearbyTextFile } from "../services/nearbyFiles";
  import { openPath } from "../services/fileSystem";
  import { completeOpenPath, requestOpenPath } from "../services/openFileGate";
  import { runInNotepadContext, workspaceRelativePath } from "../services/workspacePaths";
  import { renameDocumentOnDisk } from "../services/documentRename";

  const revealLabel = revealInFileManagerLabel();

  interface Props {
    openTabs?: TabState[];
    documents?: DocumentState[];
    windowId?: string;
    notify?: (message: string) => void;
  }

  let {
    openTabs = [],
    documents = [],
    windowId = "main",
    notify = () => {},
  }: Props = $props();

  let contextMenu = $state<{ tabId: string; x: number; y: number } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | null>(null);
  let nearbySubmenuOpen = $state(false);
  let nearbyFiles = $state<NearbyTextFile[]>([]);
  let nearbyFilesLoading = $state(false);
  let nearbyRequestId = 0;

  function tabDocument(tab: TabState): DocumentState | undefined {
    if (!isFileTab(tab)) {
      return undefined;
    }
    return documents.find((doc) => doc.id === tab.documentId);
  }

  export function openContextMenu(event: MouseEvent, tab: TabState): void {
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

  export function closeContextMenu(): void {
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

  const contextMenuTab = $derived(
    contextMenu ? (openTabs.find((tab) => tab.id === contextMenu?.tabId) ?? null) : null,
  );

  const contextMenuTabDoc = $derived(contextMenuTab ? tabDocument(contextMenuTab) : null);

  const contextMenuCanReveal = $derived(Boolean(contextMenuTab && tabDocument(contextMenuTab)?.filePath));

  const contextMenuCanRename = $derived(
    Boolean(
      contextMenuTab &&
        isFileTab(contextMenuTab) &&
        contextMenuTabDoc?.filePath &&
        !contextMenuTabDoc.fileMissing,
    ),
  );

  const contextMenuTabIndex = $derived(
    contextMenuTab ? openTabs.findIndex((tab) => tab.id === contextMenuTab.id) : -1,
  );

  const contextMenuWorkspaceRoot = $derived(appState.getWorkspaceRoot());

  const contextMenuRelativePath = $derived(
    contextMenuTabDoc?.filePath && contextMenuWorkspaceRoot
      ? workspaceRelativePath(contextMenuTabDoc.filePath, contextMenuWorkspaceRoot)
      : null,
  );

  const contextMenuCanCloseOtherTabs = $derived(
    Boolean(
      contextMenuTab &&
        openTabs.some((tab) => tab.id !== contextMenuTab.id && !tab.pinned),
    ),
  );

  const contextMenuCanCloseTabsToRight = $derived(
    contextMenuTabIndex >= 0 &&
      openTabs.slice(contextMenuTabIndex + 1).some((tab) => !tab.pinned),
  );

  const contextMenuCanCloseMissingFileTabs = $derived(
    openTabs.some((tab) => {
      if (tab.pinned) {
        return false;
      }
      return Boolean(tabDocument(tab)?.fileMissing);
    }),
  );

  const contextMenuCanOpenNearby = $derived(Boolean(contextMenuTabDoc?.filePath));

  const contextMenuCanCopyPath = $derived(Boolean(contextMenuTabDoc?.filePath));

  const contextMenuCanCopyRelativePath = $derived(contextMenuRelativePath !== null);

  const contextMenuHasNearbyFiles = $derived(nearbyFiles.length > 0);
</script>

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
