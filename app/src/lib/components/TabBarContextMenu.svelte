<script lang="ts">
  import { onDestroy } from "svelte";
  import "../styles/tab-context-menu.css";
  import type { DocumentState, TabState } from "../domain/contracts";
  import { isFileTab } from "../domain/contracts";
  import { appState } from "../state/appState";
  import { revealInFileManagerLabel } from "../services/platform";
  import type { NearbyTextFile } from "../services/nearbyFiles";
  import {
    canCloseMissingFileTabs,
    canCloseOtherTabs,
    canCloseTabsToLeft,
    canCloseTabsToRight,
    canCopyRelativePath,
    canCopyTabPath,
    canDeleteTabFile,
    canOpenNearbyFiles,
    canOpenTabInNewWindow,
    canRenameTab,
    canRevealTabInFileManager,
    createTabContextMenuHandlers,
    prefetchNearbyFilesForTab,
    tabDocumentForTab,
  } from "../services/tabContextMenuActions";
  import TabBarNearbySubmenu from "./TabBarNearbySubmenu.svelte";
  import { clampFixedOverlayPosition } from "./clampFixedOverlayPosition";
  import GitLogPopover from "./GitLogPopover.svelte";
  import { isGitIntegrationEnabledInApp } from "../git/gitIntegrationGating";
  import { openVersionControlAtCommit } from "../services/versionControlNavigation";

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
  let gitLogPopover = $state<GitLogPopover | undefined>(undefined);

  function basename(path: string): string {
    const parts = path.replaceAll("\\", "/").split("/");
    return parts[parts.length - 1] || path;
  }

  function openCommitInVersionControl(sha: string, repoRoot: string): void {
    openVersionControlAtCommit(
      appState.getActiveContext().id,
      repoRoot,
      sha,
      (message) => notify(message),
    );
  }
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

  onDestroy(() => {
    gitLogPopover?.closeGitLog();
  });

  async function loadNearbyFiles(tab: TabState): Promise<void> {
    nearbyFilesLoading = true;
    nearbyFiles = [];
    const requestId = nearbyRequestId + 1;
    nearbyRequestId = requestId;
    // H34: the loading flag must be cleared on every terminal path — a null
    // result or a rejection previously left the submenu spinning forever
    // (plus an unhandled rejection from the `void` call site). Only a
    // superseded request leaves the flag alone: the newer request owns it.
    let result: Awaited<ReturnType<typeof prefetchNearbyFilesForTab>> = null;
    try {
      result = await prefetchNearbyFilesForTab(tab, documents, openTabs, requestId);
    } catch {
      result = null;
    }
    if (nearbyRequestId !== requestId) {
      return;
    }
    nearbyFiles = result?.files ?? [];
    nearbyFilesLoading = false;
  }

  const contextMenuCanReveal = $derived(canRevealTabInFileManager(contextMenuTab, documents));
  /** Git Log needs git enabled and a tab backed by a real file on disk. */
  const contextMenuGitLogPath = $derived.by(() => {
    if (!isGitIntegrationEnabledInApp()) {
      return null;
    }
    return contextMenuTabDoc?.filePath ?? null;
  });
  const contextMenuCanRename = $derived(canRenameTab(contextMenuTab, contextMenuTabDoc));
  const contextMenuWorkspaceRoot = $derived(appState.getWorkspaceRoot());
  const contextMenuCanDelete = $derived(
    canDeleteTabFile(contextMenuTab, contextMenuTabDoc, contextMenuWorkspaceRoot),
  );
  const contextMenuCanCloseOtherTabs = $derived(canCloseOtherTabs(openTabs, contextMenuTab));
  const contextMenuCanCloseTabsToLeft = $derived(canCloseTabsToLeft(openTabs, contextMenuTab));
  const contextMenuCanCloseTabsToRight = $derived(canCloseTabsToRight(openTabs, contextMenuTab));
  const contextMenuCanCloseMissingFileTabs = $derived(canCloseMissingFileTabs(openTabs, documents));
  const contextMenuCanOpenInNewWindow = $derived(
    canOpenTabInNewWindow(contextMenuTab, appState.isNotepadActive()),
  );
  const contextMenuCanOpenNearby = $derived(canOpenNearbyFiles(contextMenuTabDoc));
  const contextMenuCanCopyPath = $derived(canCopyTabPath(contextMenuTabDoc));
  const contextMenuCanCopyRelativePath = $derived(
    canCopyRelativePath(contextMenuTabDoc?.filePath, contextMenuWorkspaceRoot),
  );

  // After mount, measure the menu and clamp so items stay inside the viewport (M72).
  $effect(() => {
    const menu = contextMenu;
    const el = contextMenuEl;
    if (!menu || !el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const next = clampFixedOverlayPosition(menu.x, menu.y, rect.width, rect.height);
    if (next.x !== menu.x || next.y !== menu.y) {
      contextMenu = { ...menu, x: next.x, y: next.y };
    }
  });
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

    <div class="ui-rule" role="separator"></div>

    <button
      class="tab-context-item"
      type="button"
      role="menuitem"
      disabled={!contextMenuCanCloseTabsToLeft}
      onpointerdown={(event) => {
        event.stopPropagation();
        if (contextMenuCanCloseTabsToLeft) {
          menuHandlers.closeTabsToLeftWithPrompt();
        }
      }}
    >
      Close Tabs to the Left
    </button>
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

    <div class="ui-rule" role="separator"></div>

    <button
      class="tab-context-item"
      type="button"
      role="menuitem"
      disabled={!contextMenuCanOpenInNewWindow}
      title={contextMenuCanOpenInNewWindow
        ? "Move this file into a new window"
        : "Only Notepad tabs can be opened in another window"}
      onpointerdown={(event) => {
        event.stopPropagation();
        if (contextMenuCanOpenInNewWindow) {
          void menuHandlers.openContextTabInNewWindow();
        }
      }}
    >
      Open in New Window
    </button>

    <div class="ui-rule" role="separator"></div>

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

    <div class="ui-rule" role="separator"></div>

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

    {#if contextMenuGitLogPath}
      <div class="ui-rule" role="separator"></div>
      <button
        class="tab-context-item"
        type="button"
        role="menuitem"
        onpointerdown={(event) => {
          event.stopPropagation();
          const path = contextMenuGitLogPath;
          const anchor = contextMenu;
          closeContextMenu();
          if (path && anchor) {
            // Anchor the popup where the context menu was opened.
            gitLogPopover?.openGitLog(
              new MouseEvent("contextmenu", { clientX: anchor.x, clientY: anchor.y }),
              { path, isFile: true, label: basename(path) },
            );
          }
        }}
      >
        Git Log…
      </button>
    {/if}

    {#if contextMenuCanRename}
      <div class="ui-rule" role="separator"></div>
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

    {#if contextMenuCanDelete}
      <button
        class="tab-context-item tab-context-item-danger"
        type="button"
        role="menuitem"
        onpointerdown={(event) => {
          event.stopPropagation();
          void menuHandlers.deleteContextTabFile();
        }}
      >
        Remove
      </button>
    {/if}

    <div class="ui-rule" role="separator"></div>

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

<GitLogPopover bind:this={gitLogPopover} onOpenCommit={openCommitInVersionControl} />
