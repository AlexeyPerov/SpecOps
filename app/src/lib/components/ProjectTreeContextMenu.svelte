<script lang="ts">
  import type { ProjectSizeEntry } from "../services/projectSizes";
  import { emptyMap } from "../collections/emptyCollections";
  import { normalizePathSync } from "../services/diskFingerprint";
  import { onDestroy } from "svelte";
  import type { ProjectTreeNode } from "../services/projectTree";
  import { revealInFileManagerLabel } from "../services/platform";
  import { revealInFileManager } from "../services/revealInFileManager";
  import { workspaceRelativePath } from "../services/workspacePaths";
  import { clampFixedOverlayPosition } from "./clampFixedOverlayPosition";
  import { emptySet } from "../collections/emptyCollections";

  const revealLabel = revealInFileManagerLabel();

  export interface ProjectTreeContextTarget {
    nodes?: readonly ProjectTreeNode[];
    node: ProjectTreeNode | null;
    parentDirPath: string;
  }

  interface Props {
    sizeEntries?: ReadonlyMap<string, ProjectSizeEntry>;
    onCalculateFolderSize?: (path: string) => void;
    onCancelFolderSize?: (path: string) => void;
    busy?: boolean;
    notify?: (message: string) => void;
    onMoveSelected?: (entries: readonly ProjectTreeNode[]) => void;
    onDeleteSelected?: (entries: readonly ProjectTreeNode[]) => void;
    onFavoriteSelected?: (entries: readonly ProjectTreeNode[], favorite: boolean) => void;
    favoritePaths?: ReadonlySet<string>;
    onToggleFavorite?: (node: ProjectTreeNode) => void;
    workspaceRoot?: string;
    /** Opens the git-log popup for `path` at the menu's position. */
    onShowGitLog?: (event: MouseEvent, path: string, isFile: boolean) => void;
    /** False when git integration is off — the Git Log item is then hidden. */
    gitEnabled?: boolean;
    onOpenFile?: (path: string) => void;
    onNewFile?: (parentDirPath: string) => void;
    onNewFolder?: (parentDirPath: string) => void;
    onRename?: (path: string, kind: ProjectTreeNode["kind"]) => void;
    onDelete?: (path: string, kind: ProjectTreeNode["kind"]) => void;
  }

  let {
    sizeEntries = emptyMap<string, ProjectSizeEntry>(),
    onCalculateFolderSize,
    onCancelFolderSize,
    busy = false,
    notify = () => {},
    onMoveSelected = () => {},
    onDeleteSelected = () => {},
    onFavoriteSelected = () => {},
    favoritePaths = emptySet<string>(),
    onToggleFavorite = () => {},
    workspaceRoot = "",
    onShowGitLog,
    gitEnabled = false,
    onOpenFile = () => {},
    onNewFile = () => {},
    onNewFolder = () => {},
    onRename = () => {},
    onDelete = () => {},
  }: Props = $props();

  let contextMenu = $state<{ x: number; y: number; target: ProjectTreeContextTarget } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | null>(null);

  function detachWindowListeners(): void {
    window.removeEventListener("pointerdown", handlePointerDownOutside, true);
    window.removeEventListener("keydown", handleKeyDown, true);
  }

  export function openContextMenu(
    event: MouseEvent,
    target: ProjectTreeContextTarget,
  ): void {
    event.preventDefault();
    closeContextMenu();
    contextMenu = { x: event.clientX, y: event.clientY, target };
    window.addEventListener("pointerdown", handlePointerDownOutside, true);
    window.addEventListener("keydown", handleKeyDown, true);
  }

  export function closeContextMenu(): void {
    contextMenu = null;
    // Always detach — even when the menu was already null — so an unmount
    // (or a redundant close) cannot leave capture-phase window listeners
    // attached (M62).
    detachWindowListeners();
  }

  function handlePointerDownOutside(event: PointerEvent): void {
    const target = event.target;
    if (target instanceof Node && contextMenuEl?.contains(target)) {
      return;
    }
    closeContextMenu();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (contextMenu && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeContextMenu();
    }
  }

  onDestroy(() => {
    closeContextMenu();
  });

  const menuTarget = $derived(contextMenu?.target ?? null);
  const targets = $derived(menuTarget?.nodes ?? (menuTarget?.node ? [menuTarget.node] : []));
  const multiple = $derived(targets.length > 1);
  const isFile = $derived(menuTarget?.node?.kind === "file");
  const hasNode = $derived(menuTarget?.node !== null && menuTarget?.node !== undefined);
  const nodePath = $derived(menuTarget?.node?.path ?? null);
  const parentDirPath = $derived(menuTarget?.parentDirPath ?? "");
  const nodeKind = $derived(menuTarget?.node?.kind);

  const canCopyPath = $derived(Boolean(nodePath));
  const relativePath = $derived(
    nodePath && workspaceRoot ? workspaceRelativePath(nodePath, workspaceRoot) : null,
  );
  const canCopyRelativePath = $derived(relativePath !== null);

  async function copyPath(): Promise<void> {
    if (!nodePath) {
      closeContextMenu();
      return;
    }
    try {
      await navigator.clipboard.writeText(targets.map((node) => multiple ? `- ${node.path}` : node.path).join("\n"));
    } catch {
      notify("Could not copy paths to clipboard.");
    }
    closeContextMenu();
  }

  async function copyRelativePath(): Promise<void> {
    if (relativePath === null) {
      closeContextMenu();
      return;
    }
    try {
      await navigator.clipboard.writeText(targets.map((node) => workspaceRelativePath(node.path, workspaceRoot)).filter((path) => path !== null).map((path) => multiple ? `- ${path}` : path).join("\n"));
    } catch {
      notify("Could not copy paths to clipboard.");
    }
    closeContextMenu();
  }

  async function revealEntryInFileManager(): Promise<void> {
    if (!nodePath) {
      closeContextMenu();
      return;
    }
    try {
      await revealInFileManager(nodePath);
    } catch {
      // reveal is best-effort from the project tree menu
    }
    closeContextMenu();
  }

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

{#if contextMenu && menuTarget}
  <div
    bind:this={contextMenuEl}
    class="project-tree-context-menu"
    style={`left:${contextMenu.x}px; top:${contextMenu.y}px;`}
    role="menu"
    tabindex="-1"
    onpointerdown={(event) => event.stopPropagation()}
  >
    {#if !multiple && !isFile && onCalculateFolderSize}
      {@const folderPath = nodePath ?? parentDirPath}
      {@const folderSize = sizeEntries.get(normalizePathSync(folderPath).replace(/\/+$/, ""))}
      <button class="project-tree-context-item" type="button" role="menuitem"
        onclick={() => { if (folderSize?.loading) onCancelFolderSize?.(folderPath); else onCalculateFolderSize?.(folderPath); closeContextMenu(); }}>
        {folderSize?.loading ? "Cancel size calculation" : folderSize ? "Recalculate folder size" : "Calculate folder size"}
      </button>
    {/if}
    {#if !multiple && isFile && nodePath}
      <button
        class="project-tree-context-item"
        type="button"
        role="menuitem"
        onpointerdown={(event) => {
          event.stopPropagation();
          onOpenFile(nodePath);
          closeContextMenu();
        }}
      >
        Open
      </button>
    {/if}
    {#if !multiple}
    <button
        class="project-tree-context-item"
        type="button"
        role="menuitem"
        onclick={(event) => {
          event.stopPropagation();
          const parent = parentDirPath;
          closeContextMenu();
          onNewFile(parent);
        }}
      >
        New File…
    </button>
    <button
        class="project-tree-context-item"
        type="button"
        role="menuitem"
        onclick={(event) => {
          event.stopPropagation();
          const parent = parentDirPath;
          closeContextMenu();
          onNewFolder(parent);
        }}
      >
        New Folder…
    </button>
    {#if menuTarget.node}
      <button class="project-tree-context-item" type="button" role="menuitem" onclick={() => { if (menuTarget.node) onToggleFavorite(menuTarget.node); closeContextMenu(); }}>
        {favoritePaths.has(normalizePathSync(menuTarget.node.path)) ? "Remove from Favorites" : "Add to Favorites"}
      </button>
    {/if}
    {/if}
    {#if multiple}
      <button class="project-tree-context-item" type="button" role="menuitem" onclick={() => { onFavoriteSelected(targets, true); closeContextMenu(); }}>Add to Favorites</button>
      <button class="project-tree-context-item" type="button" role="menuitem" onclick={() => { onFavoriteSelected(targets, false); closeContextMenu(); }}>Remove from Favorites</button>
    {/if}
    {#if hasNode && nodePath}
      <div class="ui-rule" role="separator"></div>
      <button
        class="project-tree-context-item"
        type="button"
        role="menuitem"
        disabled={!canCopyPath}
        onclick={() => {
          if (!canCopyPath) {
            return;
          }
          void copyPath();
        }}
      >
        {multiple ? "Copy Path List" : "Copy Path"}
      </button>
      {#if workspaceRoot}
        <button
          class="project-tree-context-item"
          type="button"
          role="menuitem"
          disabled={!canCopyRelativePath}
          onclick={() => {
            if (!canCopyRelativePath) {
              return;
            }
            void copyRelativePath();
          }}
        >
          {multiple ? "Copy Relative Path List" : "Copy Relative Path"}
        </button>
      {/if}
    {/if}
    {#if !multiple && hasNode && nodePath && gitEnabled && onShowGitLog}
      <div class="ui-rule" role="separator"></div>
      <button
        class="project-tree-context-item"
        type="button"
        role="menuitem"
        onpointerdown={(event) => {
          event.stopPropagation();
          const path = nodePath;
          const isFile = nodeKind === "file";
          const anchor = contextMenu;
          closeContextMenu();
          if (path && anchor) {
            // Re-anchor the popup where the menu was opened, not where the
            // item happened to be clicked.
            onShowGitLog(
              new MouseEvent("contextmenu", { clientX: anchor.x, clientY: anchor.y }),
              path,
              isFile,
            );
          }
        }}
      >
        Git Log…
      </button>
    {/if}
    {#if hasNode && nodePath && nodeKind}
      <button class="project-tree-context-item" type="button" role="menuitem" disabled={busy} onclick={() => { onMoveSelected(targets); closeContextMenu(); }}>Move To…</button>
      <button class="project-tree-context-item project-tree-context-item-danger" type="button" role="menuitem" disabled={busy} onclick={() => { onDeleteSelected(targets); closeContextMenu(); }}>Delete{multiple ? ` ${targets.length} items` : ""}</button>
      {#if !multiple}
      <div class="ui-rule" role="separator"></div>
      <button
        class="project-tree-context-item"
        type="button"
        role="menuitem"
        onpointerdown={(event) => {
          event.stopPropagation();
          onRename(nodePath, nodeKind);
          closeContextMenu();
        }}
      >
        Rename…
      </button>
      <div class="ui-rule" role="separator"></div>
      <button
        class="project-tree-context-item"
        type="button"
        role="menuitem"
        onpointerdown={(event) => {
          event.stopPropagation();
          void revealEntryInFileManager();
        }}
      >
        {revealLabel}
      </button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .project-tree-context-menu {
    position: fixed;
    z-index: 1100;
    min-width: 160px;
    padding: var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-overlay);
  }

  .project-tree-context-item {
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

  .project-tree-context-item:hover {
    background: var(--color-hover);
    cursor: pointer;
  }

  .project-tree-context-item-danger {
    color: var(--color-danger);
  }

  .project-tree-context-item:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .project-tree-context-item:disabled:hover {
    background: var(--color-surface-1);
  }
</style>
