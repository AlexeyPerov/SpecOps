<script lang="ts">
  import type { ProjectTreeNode as ProjectTreeNodeModel } from "../services/projectTree";
  import DirectoryIcon from "./icons/DirectoryIcon.svelte";
  import FileIcon from "./icons/FileIcon.svelte";

  interface Props {
    node: ProjectTreeNodeModel;
    depth?: number;
    isExpanded?: boolean;
    canExpand?: boolean;
    isActiveFile?: boolean;
    isDropTarget?: boolean;
    isDragging?: boolean;
    rowPath?: string;
    onToggleDirectory?: (path: string) => void;
    onOpenFile?: (path: string) => void;
    onContextMenu?: (event: MouseEvent, node: ProjectTreeNodeModel) => void;
    onPointerDown?: (event: PointerEvent, node: ProjectTreeNodeModel) => void;
    onPointerEnter?: (node: ProjectTreeNodeModel) => void;
    onPointerLeave?: () => void;
  }

  let {
    node,
    depth = 0,
    isExpanded = false,
    canExpand = false,
    isActiveFile = false,
    isDropTarget = false,
    isDragging = false,
    rowPath = "",
    onToggleDirectory = () => {},
    onOpenFile = () => {},
    onContextMenu = () => {},
    onPointerDown = () => {},
    onPointerEnter = () => {},
    onPointerLeave = () => {},
  }: Props = $props();

  function depthStyle(value: number): string {
    return `--node-depth:${value}`;
  }

  function handleClick(): void {
    if (node.kind === "directory") {
      if (!canExpand) {
        return;
      }
      onToggleDirectory(node.path);
      return;
    }
    onOpenFile(node.path);
  }

  function handlePointerDown(event: PointerEvent): void {
    onPointerDown(event, node);
  }
</script>

<li
  role="treeitem"
  aria-expanded={node.kind === "directory" ? isExpanded : undefined}
  aria-selected={isActiveFile}
>
  <button
    data-path={rowPath}
    data-tree-kind={node.kind}
    class={`project-tree-row ${isActiveFile ? "project-tree-row-active" : ""} ${isDropTarget ? "project-tree-row-drop-target" : ""} ${isDragging ? "project-tree-row-dragging" : ""}`}
    type="button"
    title={node.path}
    style={depthStyle(depth)}
    onclick={handleClick}
    oncontextmenu={(event) => onContextMenu(event, node)}
    onpointerdown={handlePointerDown}
    onpointerenter={() => onPointerEnter(node)}
    onpointerleave={onPointerLeave}
  >
    <span class={`project-tree-chevron ${node.kind === "directory" && canExpand && isExpanded ? "project-tree-chevron-open" : ""}`}>
      {node.kind === "directory" && canExpand ? "▶" : ""}
    </span>
    {#if node.kind === "directory"}
      <DirectoryIcon />
    {:else}
      <FileIcon />
    {/if}
    <span class="project-tree-label">{node.name}</span>
  </button>
</li>

<style>
  .project-tree-row {
    width: 100%;
    min-height: 24px;
    display: flex;
    align-items: center;
    gap: var(--space-6);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    padding: 0 var(--space-6);
    padding-left: calc(var(--space-6) + var(--node-depth) * var(--tree-indent));
  }

  .project-tree-row:hover {
    background: var(--color-hover);
    cursor: pointer;
  }

  .project-tree-row-active {
    background: var(--color-hover);
    border: 1px solid var(--color-border-subtle);
  }

  .project-tree-row-drop-target {
    outline: 1px solid var(--color-accent, var(--color-border-subtle));
    background: var(--color-hover);
  }

  .project-tree-row-dragging {
    opacity: 0.45;
  }

  .project-tree-chevron {
    width: 10px;
    color: var(--color-text-secondary);
    transform: rotate(0deg);
    transition: transform var(--motion-fast) var(--easing-standard);
  }

  .project-tree-chevron-open {
    transform: rotate(90deg);
  }

  .project-tree-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
