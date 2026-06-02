<script lang="ts">
  import type { ProjectTreeNode } from "../services/projectTree";

  export interface ProjectTreeContextTarget {
    node: ProjectTreeNode | null;
    parentDirPath: string;
  }

  interface Props {
    onOpenFile?: (path: string) => void;
    onNewFile?: (parentDirPath: string) => void;
    onNewFolder?: (parentDirPath: string) => void;
    onRename?: (path: string, kind: ProjectTreeNode["kind"]) => void;
    onDelete?: (path: string, kind: ProjectTreeNode["kind"]) => void;
  }

  let {
    onOpenFile = () => {},
    onNewFile = () => {},
    onNewFolder = () => {},
    onRename = () => {},
    onDelete = () => {},
  }: Props = $props();

  let contextMenu = $state<{ x: number; y: number; target: ProjectTreeContextTarget } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | null>(null);

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
    if (!contextMenu) {
      return;
    }
    contextMenu = null;
    window.removeEventListener("pointerdown", handlePointerDownOutside, true);
    window.removeEventListener("keydown", handleKeyDown, true);
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
      closeContextMenu();
    }
  }

  const menuTarget = $derived(contextMenu?.target ?? null);
  const isFile = $derived(menuTarget?.node?.kind === "file");
  const isDirectory = $derived(menuTarget?.node?.kind === "directory");
  const hasNode = $derived(menuTarget?.node !== null && menuTarget?.node !== undefined);
  const nodePath = $derived(menuTarget?.node?.path ?? null);
  const parentDirPath = $derived(menuTarget?.parentDirPath ?? "");
  const nodeKind = $derived(menuTarget?.node?.kind);
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
    {#if isFile && nodePath}
      <button
        class="project-tree-context-item"
        type="button"
        role="menuitem"
        onclick={() => {
          onOpenFile(nodePath);
          closeContextMenu();
        }}
      >
        Open
      </button>
    {/if}
    {#if isDirectory || !hasNode}
      <button
        class="project-tree-context-item"
        type="button"
        role="menuitem"
        onclick={() => {
          onNewFile(parentDirPath);
          closeContextMenu();
        }}
      >
        New File…
      </button>
      <button
        class="project-tree-context-item"
        type="button"
        role="menuitem"
        onclick={() => {
          onNewFolder(parentDirPath);
          closeContextMenu();
        }}
      >
        New Folder…
      </button>
    {/if}
    {#if hasNode && nodePath && nodeKind}
      <button
        class="project-tree-context-item"
        type="button"
        role="menuitem"
        onclick={() => {
          onRename(nodePath, nodeKind);
          closeContextMenu();
        }}
      >
        Rename…
      </button>
      <button
        class="project-tree-context-item project-tree-context-item-danger"
        type="button"
        role="menuitem"
        onclick={() => {
          onDelete(nodePath, nodeKind);
          closeContextMenu();
        }}
      >
        Delete
      </button>
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
    color: var(--color-danger, #c44);
  }
</style>
