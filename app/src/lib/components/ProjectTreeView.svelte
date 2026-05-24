<script lang="ts">
  import type { ProjectTreeNode } from "../services/projectTree";
  import ProjectTreeList from "./ProjectTreeList.svelte";

  export let nodes: ProjectTreeNode[] = [];
  export let expandedPaths = new Set<string>();
  export let childrenByPath = new Map<string, ProjectTreeNode[]>();
  export let loadingPaths = new Set<string>();
  export let activeFilePath: string | null = null;
  export let onToggleDirectory: (path: string) => void = () => {};
  export let onOpenFile: (path: string) => void = () => {};
</script>

<div class="project-tree-view" role="tree" aria-label="Project files">
  <ProjectTreeList
    nodes={nodes}
    depth={0}
    {expandedPaths}
    {childrenByPath}
    {loadingPaths}
    {activeFilePath}
    {onToggleDirectory}
    {onOpenFile}
  />
</div>

<style>
  .project-tree-view {
    min-height: 0;
    padding: var(--space-6);
  }
</style>
