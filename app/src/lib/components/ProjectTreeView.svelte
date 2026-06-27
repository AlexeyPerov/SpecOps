<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ProjectTreeNode } from "../services/projectTree";
  import type { OpencodeFileChangeStatus } from "../ai/backends/workspaceAgentBackend";
  import ProjectTreeList from "./ProjectTreeList.svelte";
  import {
    createProjectTreeDragController,
    type ProjectTreeDragState,
  } from "./projectTreeDrag";

  interface Props {
    nodes?: ProjectTreeNode[];
    workspaceRoot?: string;
    expandedPaths?: Set<string>;
    childrenByPath?: Map<string, ProjectTreeNode[]>;
    loadingPaths?: Set<string>;
    activeFilePath?: string | null;
    /** M5-T3 — absolute path → git change status, for badges. */
    statusByPath?: ReadonlyMap<string, OpencodeFileChangeStatus> | null;
    onToggleDirectory?: (path: string) => void;
    onOpenFile?: (path: string) => void;
    onContextMenuRoot?: (event: MouseEvent) => void;
    onContextMenuNode?: (event: MouseEvent, node: ProjectTreeNode) => void;
    onMoveEntry?: (sourcePath: string, destDirPath: string) => Promise<void>;
    notify?: (message: string) => void;
  }

  let {
    nodes = [],
    workspaceRoot = "",
    expandedPaths = new Set<string>(),
    childrenByPath = new Map<string, ProjectTreeNode[]>(),
    loadingPaths = new Set<string>(),
    activeFilePath = null,
    statusByPath = null,
    onToggleDirectory = () => {},
    onOpenFile = () => {},
    onContextMenuRoot = () => {},
    onContextMenuNode = () => {},
    onMoveEntry = async () => {},
    notify = () => {},
  }: Props = $props();

  let ignoreNextActivation = false;

  let dragState = $state<ProjectTreeDragState>({
    pointerId: null,
    sourcePath: null,
    sourceKind: null,
    dropTargetPath: null,
    didDrag: false,
    startX: 0,
    startY: 0,
  });

  const dragController = createProjectTreeDragController({
    getWorkspaceRoot: () => workspaceRoot || null,
    onMove: (sourcePath, destDirPath) => onMoveEntry(sourcePath, destDirPath),
    notify: (message) => notify(message),
    onStateChange: (next) => {
      dragState = next;
    },
  });

  function handleWindowPointerMove(event: PointerEvent): void {
    dragController.handlePointerMove(event);
  }

  async function handleWindowPointerUp(event: PointerEvent): Promise<void> {
    if (dragState.pointerId !== event.pointerId) {
      return;
    }
    const wasDrag = dragState.didDrag;
    const consumed = await dragController.finishDrop();
    if (wasDrag || consumed) {
      ignoreNextActivation = true;
      event.preventDefault();
      event.stopPropagation();
    }
    detachDragListeners();
  }

  function shouldIgnoreActivation(): boolean {
    if (!ignoreNextActivation) {
      return false;
    }
    ignoreNextActivation = false;
    return true;
  }

  function handleOpenFile(path: string): void {
    if (shouldIgnoreActivation()) {
      return;
    }
    onOpenFile(path);
  }

  function handleToggleDirectory(path: string): void {
    if (shouldIgnoreActivation()) {
      return;
    }
    onToggleDirectory(path);
  }

  function detachDragListeners(): void {
    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", handleWindowPointerUp);
    window.removeEventListener("pointercancel", handleWindowPointerUp);
  }

  function handlePointerDown(event: PointerEvent, node: ProjectTreeNode): void {
    dragController.handlePointerDown(event, node);
    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerUp);
  }

  function handlePointerEnter(node: ProjectTreeNode): void {
    if (!dragState.didDrag || node.kind !== "directory") {
      return;
    }
    dragController.setDropTarget(node.path);
  }

  function handlePointerLeave(): void {
    if (dragState.didDrag) {
      dragController.setDropTarget(null);
    }
  }

  onDestroy(() => {
    detachDragListeners();
    dragController.cancel();
  });
</script>

<div
  class="project-tree-view"
  role="tree"
  tabindex="0"
  aria-label="Project files"
  data-dragging={dragState.didDrag}
  oncontextmenu={onContextMenuRoot}
>
  <ProjectTreeList
    {nodes}
    depth={0}
    {expandedPaths}
    {childrenByPath}
    {loadingPaths}
    {activeFilePath}
    {statusByPath}
    {dragState}
    onToggleDirectory={handleToggleDirectory}
    onOpenFile={handleOpenFile}
    onContextMenu={onContextMenuNode}
    onPointerDown={handlePointerDown}
    onPointerEnter={handlePointerEnter}
    onPointerLeave={handlePointerLeave}
  />
</div>

<style>
  .project-tree-view {
    min-height: 0;
    padding: var(--space-2);
  }

  .project-tree-view[data-dragging="true"] {
    cursor: grabbing;
  }
</style>
