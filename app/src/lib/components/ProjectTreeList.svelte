<script lang="ts">
  import type { ProjectTreeNode as ProjectTreeNodeModel } from "../services/projectTree";
  import ProjectTreeList from "./ProjectTreeList.svelte";
  import ProjectTreeNode from "./ProjectTreeNode.svelte";

  export let nodes: ProjectTreeNodeModel[] = [];
  export let depth = 0;
  export let expandedPaths = new Set<string>();
  export let childrenByPath = new Map<string, ProjectTreeNodeModel[]>();
  export let loadingPaths = new Set<string>();
  export let activeFilePath: string | null = null;
  export let onToggleDirectory: (path: string) => void = () => {};
  export let onOpenFile: (path: string) => void = () => {};
</script>

<ul class="project-tree-list" role="group">
  {#each nodes as node (node.path)}
    <ProjectTreeNode
      {node}
      {depth}
      rowPath={node.path}
      isExpanded={expandedPaths.has(node.path)}
      isActiveFile={node.kind === "file" && activeFilePath === node.path}
      {onToggleDirectory}
      {onOpenFile}
    />
    {#if node.kind === "directory" && expandedPaths.has(node.path)}
      {#if loadingPaths.has(node.path)}
        <li class="project-tree-loading" role="treeitem" aria-selected={false} aria-busy="true">
          Loading...
        </li>
      {:else}
        <ProjectTreeList
          nodes={childrenByPath.get(node.path) ?? []}
          depth={depth + 1}
          {expandedPaths}
          {childrenByPath}
          {loadingPaths}
          {activeFilePath}
          {onToggleDirectory}
          {onOpenFile}
        />
      {/if}
    {/if}
  {/each}
</ul>

<style>
  .project-tree-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }

  .project-tree-loading {
    list-style: none;
    color: var(--color-text-secondary);
    font-size: var(--font-size-status);
    padding: 0 var(--space-8);
    padding-left: calc(var(--space-8) + (var(--tree-indent) * 1));
  }
</style>
