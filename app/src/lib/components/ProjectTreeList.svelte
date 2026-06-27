<script lang="ts">
  import type { ProjectTreeNode as ProjectTreeNodeModel } from "../services/projectTree";
  import type { ProjectTreeDragState } from "./projectTreeDrag";
  import type { OpencodeFileChangeStatus } from "../ai/backends/workspaceAgentBackend";
  import ProjectTreeNode from "./ProjectTreeNode.svelte";
  import Self from "./ProjectTreeList.svelte";

  interface Props {
    nodes?: ProjectTreeNodeModel[];
    depth?: number;
    expandedPaths?: Set<string>;
    childrenByPath?: Map<string, ProjectTreeNodeModel[]>;
    loadingPaths?: Set<string>;
    activeFilePath?: string | null;
    dragState?: ProjectTreeDragState | null;
    /** M5-T3 — absolute path → git change status, for badges. */
    statusByPath?: ReadonlyMap<string, OpencodeFileChangeStatus> | null;
    onToggleDirectory?: (path: string) => void;
    onOpenFile?: (path: string) => void;
    onContextMenu?: (event: MouseEvent, node: ProjectTreeNodeModel) => void;
    onPointerDown?: (event: PointerEvent, node: ProjectTreeNodeModel) => void;
    onPointerEnter?: (node: ProjectTreeNodeModel) => void;
    onPointerLeave?: () => void;
  }

  let {
    nodes = [],
    depth = 0,
    expandedPaths = new Set<string>(),
    childrenByPath = new Map<string, ProjectTreeNodeModel[]>(),
    loadingPaths = new Set<string>(),
    activeFilePath = null,
    dragState = null,
    statusByPath = null,
    onToggleDirectory = () => {},
    onOpenFile = () => {},
    onContextMenu = () => {},
    onPointerDown = () => {},
    onPointerEnter = () => {},
    onPointerLeave = () => {},
  }: Props = $props();
</script>

<ul class="project-tree-list" role="group">
  {#each nodes as node (node.path)}
    {@const hasLoadedChildren = node.kind === "directory" && childrenByPath.has(node.path)}
    {@const children = node.kind === "directory" ? (childrenByPath.get(node.path) ?? []) : []}
    {@const canExpand =
      node.kind === "directory" && (!hasLoadedChildren || children.length > 0 || loadingPaths.has(node.path))}
    <ProjectTreeNode
      {node}
      {depth}
      rowPath={node.path}
      isExpanded={expandedPaths.has(node.path)}
      {canExpand}
      isActiveFile={node.kind === "file" && activeFilePath === node.path}
      isDropTarget={dragState?.didDrag === true &&
        node.kind === "directory" &&
        dragState.dropTargetPath === node.path}
      isDragging={dragState?.didDrag === true && dragState.sourcePath === node.path}
      fileChangeStatus={statusByPath?.get(node.path) ?? null}
      {onToggleDirectory}
      {onOpenFile}
      {onContextMenu}
      {onPointerDown}
      {onPointerEnter}
      {onPointerLeave}
    />
    {#if node.kind === "directory" && canExpand && expandedPaths.has(node.path)}
      {#if loadingPaths.has(node.path)}
        <li class="project-tree-loading" role="treeitem" aria-selected={false} aria-busy="true">
          Loading...
        </li>
      {:else}
        <Self
          nodes={children}
          depth={depth + 1}
          {expandedPaths}
          {childrenByPath}
          {loadingPaths}
          {activeFilePath}
          {dragState}
          {statusByPath}
          {onToggleDirectory}
          {onOpenFile}
          {onContextMenu}
          {onPointerDown}
          {onPointerEnter}
          {onPointerLeave}
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
    gap: var(--space-1);
  }

  .project-tree-loading {
    list-style: none;
    color: var(--color-text-secondary);
    font-size: var(--font-size-status);
    padding: 0 var(--space-8);
    padding-left: calc(var(--space-8) + (var(--tree-indent) * 1));
  }
</style>
