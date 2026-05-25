<script lang="ts">
  import type { ProjectTreeNode as ProjectTreeNodeModel } from "../services/projectTree";
  import DirectoryIcon from "./icons/DirectoryIcon.svelte";
  import FileIcon from "./icons/FileIcon.svelte";

  export let node: ProjectTreeNodeModel;
  export let depth = 0;
  export let isExpanded = false;
  export let canExpand = false;
  export let isActiveFile = false;
  export let rowPath = "";
  export let onToggleDirectory: (path: string) => void = () => {};
  export let onOpenFile: (path: string) => void = () => {};

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
</script>

<li
  role="treeitem"
  aria-expanded={node.kind === "directory" ? isExpanded : undefined}
  aria-selected={isActiveFile}
>
  <button
    data-path={rowPath}
    class={`project-tree-row ${isActiveFile ? "project-tree-row-active" : ""}`}
    type="button"
    title={node.path}
    style={depthStyle(depth)}
    onclick={handleClick}
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
