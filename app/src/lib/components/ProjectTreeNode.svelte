<script lang="ts">
  import type { ProjectTreeNode as ProjectTreeNodeModel } from "../services/projectTree";
  import { classifyProjectTreeLabelTone } from "../services/projectTreeLabelTone";
  import { fileStatusBadgeLabel } from "../services/fileStatusTracker";
  import type { OpencodeFileChangeStatus } from "../ai/backends/workspaceAgentBackend";
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
    /** M5-T3 — git change status for this node's path, if tracked. */
    fileChangeStatus?: OpencodeFileChangeStatus | null;
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
    fileChangeStatus = null,
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

  const labelTone = $derived(classifyProjectTreeLabelTone(node.name, node.kind));
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
    <span class="project-tree-label project-tree-label-{labelTone}">{node.name}</span>
    {#if fileChangeStatus}
      <span
        class={`project-tree-status-badge project-tree-status-${fileChangeStatus}`}
        title={`${fileChangeStatus} (git)`}
        aria-label={`${fileChangeStatus}`}
      >{fileStatusBadgeLabel(fileChangeStatus)}</span>
    {/if}
  </button>
</li>

<style>
  .project-tree-row {
    width: 100%;
    min-height: 19px;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    padding: 0 var(--space-2);
    padding-left: calc(var(--space-2) + var(--node-depth) * var(--tree-indent));
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

  .project-tree-label-hidden {
    color: var(--project-pane-color-hidden);
  }

  .project-tree-label-text {
    color: var(--project-pane-color-text);
  }

  .project-tree-status-badge {
    margin-left: auto;
    flex-shrink: 0;
    min-width: 14px;
    padding: 0 2px;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 9px;
    font-weight: 600;
    line-height: 1.5;
    text-align: center;
  }

  .project-tree-status-modified {
    color: var(--color-text-secondary);
    background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  }

  .project-tree-status-added {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  }

  .project-tree-status-deleted {
    color: #e06c75;
    background: color-mix(in srgb, #e06c75 16%, transparent);
  }
</style>
