<script lang="ts">
  import "../styles/tab-context-menu.css";
  import type { DocumentState, TabState } from "../domain/contracts";
  import { isFileTab } from "../domain/contracts";
  import { appState } from "../state/appState";
  import { revealInFileManagerLabel } from "../services/platform";
  import type { NearbyTextFile } from "../services/nearbyFiles";
  import {
    canCloseMissingFileTabs,
    canCloseOtherTabs,
    canCloseTabsToRight,
    canCopyRelativePath,
    canCopyTabPath,
    canOpenNearbyFiles,
    canRenameTab,
    canRevealTabInFileManager,
    createTabContextMenuHandlers,
    prefetchNearbyFilesForTab,
    tabDocumentForTab,
  } from "../services/tabContextMenuActions";
  import TabBarNearbySubmenu from "./TabBarNearbySubmenu.svelte";

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

  const contextMenuTab = $derived(
    contextMenu ? (openTabs.find((tab) => tab.id === contextMenu?.tabId) ?? null) : null,
  );

  const contextMenuTabDoc = $derived(
    contextMenuTab ? (tabDocumentForTab(contextMenuTab, documents) ?? null) : null,
  );

  const menuHandlers = createTabContextMenuHandlers({
    getContextTab: () => contextMenuTab,
    getOpenTabs: () => openTabs,
    getDocuments: () => documents,
    getWindowId: () => windowId,
    notify: (message) => notify(message),
    closeContextMenu,
    getNearbyFiles: () => nearbyFiles,
  });

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
    void loadNearbyFiles(tab);
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

  async function loadNearbyFiles(tab: TabState): Promise<void> {
    nearbyFilesLoading = true;
    nearbyFiles = [];
    const requestId = nearbyRequestId + 1;
    nearbyRequestId = requestId;
    const result = await prefetchNearbyFilesForTab(tab, documents, openTabs, requestId);
    if (!result || nearbyRequestId !== requestId) {
      return;
    }
    nearbyFiles = result.files;
    nearbyFilesLoading = false;
  }

  const contextMenuCanReveal = $derived(canRevealTabInFileManager(contextMenuTab, documents));
  const contextMenuCanRename = $derived(canRenameTab(contextMenuTab, contextMenuTabDoc));
  const contextMenuWorkspaceRoot = $derived(appState.getWorkspaceRoot());
  const contextMenuCanCloseOtherTabs = $derived(canCloseOtherTabs(openTabs, contextMenuTab));
  const contextMenuCanCloseTabsToRight = $derived(canCloseTabsToRight(openTabs, contextMenuTab));
  const contextMenuCanCloseMissingFileTabs = $derived(canCloseMissingFileTabs(openTabs, documents));
  const contextMenuCanOpenNearby = $derived(canOpenNearbyFiles(contextMenuTabDoc));
  const contextMenuCanCopyPath = $derived(canCopyTabPath(contextMenuTabDoc));
  const contextMenuCanCopyRelativePath = $derived(
    canCopyRelativePath(contextMenuTabDoc?.filePath, contextMenuWorkspaceRoot),
  );
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
        menuHandlers.closeContextTabWithPrompt();
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
        if (contextMenuCanCloseOtherTabs) {
          menuHandlers.closeOtherTabsWithPrompt();
        }
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
        if (contextMenuCanCloseTabsToRight) {
          menuHandlers.closeTabsToRightWithPrompt();
        }
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
        if (contextMenuCanCloseMissingFileTabs) {
          menuHandlers.closeMissingFileTabs();
        }
      }}
    >
      Close Missing File Tabs
    </button>

    <div class="tab-context-separator" role="separator"></div>

    <TabBarNearbySubmenu
      open={nearbySubmenuOpen}
      enabled={contextMenuCanOpenNearby}
      loading={nearbyFilesLoading}
      files={nearbyFiles}
      menuEl={contextMenuEl}
      onOpenChange={(next) => {
        nearbySubmenuOpen = next;
      }}
      onOpenFile={(path) => {
        void menuHandlers.openNearbyFile(path);
      }}
      onOpenAll={() => {
        void menuHandlers.openAllNearbyFiles();
      }}
    />

    <div class="tab-context-separator" role="separator"></div>

    <button
      class="tab-context-item"
      type="button"
      role="menuitem"
      disabled={!contextMenuCanCopyPath}
      onpointerdown={(event) => {
        event.stopPropagation();
        if (contextMenuCanCopyPath && contextMenuTab) {
          void menuHandlers.copyTabPath(contextMenuTab);
        }
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
          if (contextMenuCanCopyRelativePath && contextMenuTab) {
            void menuHandlers.copyTabRelativePath(contextMenuTab);
          }
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
          void menuHandlers.renameContextTab();
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
        if (contextMenuCanReveal) {
          void menuHandlers.revealTabInFileManager(contextMenuTab);
        }
      }}
    >
      {revealLabel}
    </button>
  </div>
{/if}
