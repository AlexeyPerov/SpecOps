<script lang="ts">
  import ProjectTreeView from "./ProjectTreeView.svelte";
  import ProjectTreeContextMenu from "./ProjectTreeContextMenu.svelte";
  import type { ProjectTreeNode } from "../services/projectTree";
  import type { OpencodeFileChangeStatus } from "../ai/backends/workspaceAgentBackend";
  import type { PaneDropTargetElements } from "./paneDropTargets";
  import {
    DEFAULT_PROJECT_PANEL_WIDTH_PX,
    MAX_PANEL_WIDTH_PX,
    MIN_PANEL_WIDTH_PX,
    normalizePanelWidthPx,
  } from "../services/panelLayout";

  export let workspaceRoot: string;
  export let rootNodes: ProjectTreeNode[] = [];
  export let expandedPaths = new Set<string>();
  export let childrenByPath = new Map<string, ProjectTreeNode[]>();
  export let loadingPaths = new Set<string>();
  export let activeFilePath: string | null = null;
  /** M5-T3 — git change status badges (absolute path → status). */
  export let statusByPath: ReadonlyMap<string, OpencodeFileChangeStatus> | null = null;
  export let showHidden = false;
  export let collapsed = false;
  export let panelWidthPx = DEFAULT_PROJECT_PANEL_WIDTH_PX;
  export let onRefresh: () => void = () => {};
  export let onToggleHidden: (next: boolean) => void = () => {};
  export let onToggleCollapsed: (next: boolean) => void = () => {};
  export let onPanelWidthChange: (width: number) => void = () => {};
  export let onToggleDirectory: (path: string) => void = () => {};
  export let onOpenFile: (path: string) => void = () => {};
  export let onMoveEntry: (sourcePath: string, destDirPath: string) => Promise<void> = async () => {};
  export let onNewFile: (parentDirPath: string) => void = () => {};
  export let onNewFolder: (parentDirPath: string) => void = () => {};
  export let onRenameEntry: (path: string, kind: ProjectTreeNode["kind"]) => void = () => {};
  export let onDeleteEntry: (path: string, kind: ProjectTreeNode["kind"]) => void = () => {};
  export let notify: (message: string) => void = () => {};
  /** Phase 6 — live pane elements for file→pane DnD. */
  export let getPaneElements: () => PaneDropTargetElements[] = () => [];
  /** Phase 6 — open a file into a specific pane. */
  export let onOpenFileInPane:
    | ((filePath: string, paneId: string) => void | Promise<void>)
    | null = null;
  /** Phase 6 — reports the hovered pane during a file drag (for affordance). */
  export let onFileDropPaneChange: (paneId: string | null) => void = () => {};
  let panelBodyEl: HTMLDivElement | null = null;
  let contextMenuComponent: ProjectTreeContextMenu | undefined;
  let displayWidth = panelWidthPx;
  let isResizing = false;

  function basename(path: string): string {
    const normalized = path.replaceAll("\\", "/");
    const parts = normalized.split("/");
    return parts[parts.length - 1] || path;
  }

  $: if (panelBodyEl && activeFilePath) {
    const node = panelBodyEl.querySelector<HTMLElement>(`[data-path="${CSS.escape(activeFilePath)}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }

  $: if (!isResizing) {
    displayWidth = normalizePanelWidthPx(panelWidthPx);
  }

  function clampPanelWidth(next: number): number {
    return Math.max(MIN_PANEL_WIDTH_PX, Math.min(MAX_PANEL_WIDTH_PX, next));
  }

  function handleResizeStart(event: PointerEvent): void {
    if (collapsed) {
      return;
    }
    event.preventDefault();
    isResizing = true;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = displayWidth;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = startX - moveEvent.clientX;
      displayWidth = clampPanelWidth(startWidth + deltaX);
    };

    const onPointerEnd = (): void => {
      isResizing = false;
      target?.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      onPanelWidthChange(displayWidth);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
  }

  function openContextMenu(
    event: MouseEvent,
    target: { node: ProjectTreeNode | null; parentDirPath: string },
  ): void {
    contextMenuComponent?.openContextMenu(event, target);
  }

  function handleContextMenuRoot(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.closest("[data-path]")) {
      return;
    }
    if (target.closest(".project-panel-header")) {
      return;
    }
    const inTree = target.closest(".project-tree-view");
    const inPanelBody = target.closest(".project-panel-body");
    if (!inTree && !inPanelBody) {
      return;
    }
    event.preventDefault();
    openContextMenu(event, { node: null, parentDirPath: workspaceRoot });
  }

  function handleContextMenuNode(event: MouseEvent, node: ProjectTreeNode): void {
    const parentDirPath =
      node.kind === "directory" ? node.path : node.path.replace(/[/\\][^/\\]+$/, "") || workspaceRoot;
    openContextMenu(event, { node, parentDirPath });
  }
</script>

<aside
  class={`project-panel ${collapsed ? "project-panel-collapsed" : ""} ${isResizing ? "project-panel-resizing" : ""}`}
  aria-label="Project panel"
  style={collapsed ? undefined : `width:${displayWidth}px`}
>
  {#if !collapsed}
    <div
      class="project-panel-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize project panel"
      onpointerdown={handleResizeStart}
    ></div>
  {/if}
  <header class="project-panel-header">
    {#if !collapsed}
      <div class="project-panel-title" title={workspaceRoot}>{basename(workspaceRoot)}</div>
      <button class="project-panel-button" type="button" onclick={onRefresh} title="Refresh tree">↻</button>
      <button
        class="project-panel-button"
        type="button"
        onclick={() => onToggleHidden(!showHidden)}
        title={showHidden ? "Hide hidden files" : "Show hidden files"}
      >
        {showHidden ? "Hidden: On" : "Hidden: Off"}
      </button>
    {/if}
    <button
      class="project-panel-button"
      type="button"
      onclick={() => onToggleCollapsed(!collapsed)}
      title={collapsed ? "Expand panel" : "Collapse panel"}
    >
      {collapsed ? "⟪" : "⟫"}
    </button>
  </header>

  {#if !collapsed}
    <div
      class="project-panel-body"
      role="region"
      aria-label="Project files"
      bind:this={panelBodyEl}
      oncontextmenu={handleContextMenuRoot}
    >
      <ProjectTreeView
        nodes={rootNodes}
        {workspaceRoot}
        {expandedPaths}
        {childrenByPath}
        {loadingPaths}
        {activeFilePath}
        {statusByPath}
        {onToggleDirectory}
        {onOpenFile}
        onContextMenuRoot={handleContextMenuRoot}
        onContextMenuNode={handleContextMenuNode}
        {onMoveEntry}
        {notify}
        {getPaneElements}
        onOpenFileInPane={onOpenFileInPane ?? undefined}
        {onFileDropPaneChange}
      />
    </div>
  {/if}
</aside>

<ProjectTreeContextMenu
  bind:this={contextMenuComponent}
  {workspaceRoot}
  onOpenFile={onOpenFile}
  onNewFile={onNewFile}
  onNewFolder={onNewFolder}
  onRename={onRenameEntry}
  onDelete={onDeleteEntry}
/>

<style>
  .project-panel {
    width: var(--project-panel-width);
    position: relative;
    border-left: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
  }

  .project-panel-collapsed {
    width: 36px;
    grid-template-rows: auto;
  }

  .project-panel-resizing {
    user-select: none;
  }

  .project-panel-resize-handle {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
  }

  .project-panel-header {
    height: var(--tab-header-height);
    border-bottom: 1px solid var(--color-border-subtle);
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: 0 var(--space-6);
    min-width: 0;
  }

  .project-panel-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .project-panel-button {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    height: 22px;
    padding: 0 var(--space-6);
  }

  .project-panel-button:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .project-panel-body {
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
</style>
