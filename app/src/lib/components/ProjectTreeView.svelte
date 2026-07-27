<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ProjectTreeNode } from "../services/projectTree";
  import type { OpencodeFileChangeStatus } from "../ai/backends/workspaceAgentBackend";
  import {
    flattenProjectTree,
    projectTreeRowKey,
    type ProjectTreeRow,
  } from "../services/projectTreeFlatten";
  import { classifyProjectTreeLabelTone } from "../services/projectTreeLabelTone";
  import { fileStatusBadgeLabel } from "../services/fileStatusTracker";
  import {
    createProjectTreeDragController,
    type ProjectTreeDragState,
  } from "./projectTreeDrag";
  import type { PaneDropTargetElements } from "./paneDropTargets";
  import { emptyMap, emptySet } from "../collections/emptyCollections";
  import DirectoryIcon from "./icons/DirectoryIcon.svelte";
  import FileIcon from "./icons/FileIcon.svelte";

  /**
   * H35 — the tree renders as ONE flattened `{#each}` over the visible rows
   * (see projectTreeFlatten) instead of a recursive component per node, and
   * rows are windowed against the scrollable ancestor above
   * `VIRTUALIZE_ROW_THRESHOLD` rows, so a huge expanded tree costs the
   * viewport, not the tree.
   */

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
    /** Phase 6 — live pane elements for file→pane DnD hit-testing. */
    getPaneElements?: () => PaneDropTargetElements[];
    /** Phase 6 — open a file into a specific pane. */
    onOpenFileInPane?: (filePath: string, paneId: string) => void | Promise<void>;
    /** Phase 6 — reports the hovered pane id during a file drag (for affordance). */
    onFileDropPaneChange?: (paneId: string | null) => void;
  }

  let {
    nodes = [],
    workspaceRoot = "",
    expandedPaths = emptySet<string>(),
    childrenByPath = emptyMap<string, ProjectTreeNode[]>(),
    loadingPaths = emptySet<string>(),
    activeFilePath = null,
    statusByPath = null,
    onToggleDirectory = () => {},
    onOpenFile = () => {},
    onContextMenuRoot = () => {},
    onContextMenuNode = () => {},
    onMoveEntry = async () => {},
    notify = () => {},
    getPaneElements = () => [],
    onOpenFileInPane,
    onFileDropPaneChange = () => {},
  }: Props = $props();

  let ignoreNextActivation = false;

  let dragState = $state<ProjectTreeDragState>({
    pointerId: null,
    sourcePath: null,
    sourceKind: null,
    dropTargetPath: null,
    dropPaneId: null,
    didDrag: false,
    startX: 0,
    startY: 0,
  });

  // Lift the file-drop pane id to the parent so the editor grid can render an
  // affordance on the hovered pane.
  $effect(() => {
    onFileDropPaneChange(dragState.didDrag ? dragState.dropPaneId : null);
  });

  const dragController = createProjectTreeDragController({
    getWorkspaceRoot: () => workspaceRoot || null,
    onMove: (sourcePath, destDirPath) => onMoveEntry(sourcePath, destDirPath),
    notify: (message) => notify(message),
    getPaneElements: () => getPaneElements(),
    onOpenFileInPane: (filePath, paneId) => onOpenFileInPane?.(filePath, paneId),
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

  function handleRowClick(row: Extract<ProjectTreeRow, { kind: "node" }>): void {
    if (row.node.kind === "directory") {
      if (!row.canExpand) {
        return;
      }
      handleToggleDirectory(row.node.path);
      return;
    }
    handleOpenFile(row.node.path);
  }

  onDestroy(() => {
    detachDragListeners();
    dragController.cancel();
  });

  // ---- Flattened rows + windowing (H35) ----

  /** Below this row count everything renders (spacer math not worth it). */
  const VIRTUALIZE_ROW_THRESHOLD = 200;
  /** Extra rows rendered above/below the viewport to absorb measurement slop. */
  const OVERSCAN_ROWS = 12;
  /** Fallback pitch (row height + list gap) until a real pair is measured. */
  const FALLBACK_ROW_PITCH = 21;

  const rows = $derived(
    flattenProjectTree(nodes, expandedPaths, childrenByPath, loadingPaths),
  );

  let listEl = $state<HTMLElement | null>(null);
  let scrollParent = $state<HTMLElement | null>(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(800);
  let listOffsetTop = $state(0);
  let rowPitch = $state(FALLBACK_ROW_PITCH);

  function findScrollParent(el: HTMLElement): HTMLElement | null {
    let parent = el.parentElement;
    while (parent) {
      const overflowY = getComputedStyle(parent).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  $effect(() => {
    const el = listEl;
    if (!el || typeof window === "undefined") {
      return;
    }
    const parent = findScrollParent(el);
    scrollParent = parent;
    if (!parent) {
      return;
    }
    const measure = (): void => {
      viewportHeight = parent.clientHeight;
      listOffsetTop =
        el.getBoundingClientRect().top -
        parent.getBoundingClientRect().top +
        parent.scrollTop;
    };
    const onScroll = (): void => {
      scrollTop = parent.scrollTop;
    };
    measure();
    onScroll();
    parent.addEventListener("scroll", onScroll, { passive: true });
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(parent);
    }
    return () => {
      parent.removeEventListener("scroll", onScroll);
      resizeObserver?.disconnect();
      scrollParent = null;
    };
  });

  // Measure the real row pitch (row height + list gap) from two consecutive
  // rendered rows; keeps the window math correct across zoom/font changes.
  $effect(() => {
    void rows;
    const el = listEl;
    if (!el) {
      return;
    }
    const rowEls = el.querySelectorAll<HTMLElement>("li[data-tree-row]");
    if (rowEls.length >= 2) {
      const pitch = rowEls[1].offsetTop - rowEls[0].offsetTop;
      if (pitch > 8 && Math.abs(pitch - rowPitch) > 0.5) {
        rowPitch = pitch;
      }
    }
  });

  const visibleRange = $derived.by(() => {
    const total = rows.length;
    if (!scrollParent || total <= VIRTUALIZE_ROW_THRESHOLD) {
      return { start: 0, end: total };
    }
    const localTop = Math.max(0, scrollTop - listOffsetTop);
    const start = Math.max(0, Math.floor(localTop / rowPitch) - OVERSCAN_ROWS);
    const end = Math.min(
      total,
      Math.ceil((localTop + viewportHeight) / rowPitch) + OVERSCAN_ROWS,
    );
    return { start, end };
  });

  const visibleRows = $derived(rows.slice(visibleRange.start, visibleRange.end));
  const topPadPx = $derived(visibleRange.start * rowPitch);
  const bottomPadPx = $derived(
    Math.max(0, (rows.length - visibleRange.end) * rowPitch),
  );

  // Reveal the active file even when its row is outside the rendered window
  // (the parent panel's scrollIntoView can only reach rows that are in the
  // DOM). Runs only when the active path actually changes.
  let lastRevealedPath: string | null = null;
  $effect(() => {
    const path = activeFilePath;
    if (path === lastRevealedPath) {
      return;
    }
    lastRevealedPath = path;
    const parent = scrollParent;
    if (!path || !parent || rows.length <= VIRTUALIZE_ROW_THRESHOLD) {
      return;
    }
    const index = rows.findIndex(
      (row) => row.kind === "node" && row.node.path === path,
    );
    if (index < 0) {
      return;
    }
    const rowTop = listOffsetTop + index * rowPitch;
    const rowBottom = rowTop + rowPitch;
    if (rowTop < parent.scrollTop) {
      parent.scrollTop = rowTop;
    } else if (rowBottom > parent.scrollTop + parent.clientHeight) {
      parent.scrollTop = rowBottom - parent.clientHeight;
    }
  });

  function rowClasses(row: Extract<ProjectTreeRow, { kind: "node" }>): string {
    const isActiveFile = row.node.kind === "file" && activeFilePath === row.node.path;
    const isDropTarget =
      dragState.didDrag === true &&
      row.node.kind === "directory" &&
      dragState.dropTargetPath === row.node.path;
    const isDragging = dragState.didDrag === true && dragState.sourcePath === row.node.path;
    return `project-tree-row ${isActiveFile ? "project-tree-row-active" : ""} ${isDropTarget ? "project-tree-row-drop-target" : ""} ${isDragging ? "project-tree-row-dragging" : ""}`;
  }
</script>

<div
  class="project-tree-view"
  role="tree"
  tabindex="0"
  aria-label="Project files"
  data-dragging={dragState.didDrag}
  oncontextmenu={onContextMenuRoot}
>
  <ul class="project-tree-list" bind:this={listEl}>
    {#if topPadPx > 0}
      <li class="project-tree-spacer" style={`height:${topPadPx}px`} aria-hidden="true"></li>
    {/if}
    {#each visibleRows as row (projectTreeRowKey(row))}
      {#if row.kind === "loading"}
        <li
          class="project-tree-loading"
          style={`--node-depth:${row.depth}`}
          role="treeitem"
          aria-level={row.depth + 1}
          aria-selected={false}
          aria-busy="true"
          data-tree-row
        >
          Loading...
        </li>
      {:else}
        {@const labelTone = classifyProjectTreeLabelTone(row.node.name, row.node.kind)}
        {@const fileChangeStatus = statusByPath?.get(row.node.path) ?? null}
        <li
          role="treeitem"
          aria-level={row.depth + 1}
          aria-expanded={row.node.kind === "directory" ? row.expanded : undefined}
          aria-selected={row.node.kind === "file" && activeFilePath === row.node.path}
          data-tree-row
        >
          <button
            data-path={row.node.path}
            data-tree-kind={row.node.kind}
            class={rowClasses(row)}
            type="button"
            title={row.node.path}
            style={`--node-depth:${row.depth}`}
            onclick={() => handleRowClick(row)}
            oncontextmenu={(event) => onContextMenuNode(event, row.node)}
            onpointerdown={(event) => handlePointerDown(event, row.node)}
            onpointerenter={() => handlePointerEnter(row.node)}
            onpointerleave={handlePointerLeave}
          >
            <span
              class={`project-tree-chevron ${row.node.kind === "directory" && row.canExpand && row.expanded ? "project-tree-chevron-open" : ""}`}
            >
              {row.node.kind === "directory" && row.canExpand ? "▶" : ""}
            </span>
            {#if row.node.kind === "directory"}
              <DirectoryIcon />
            {:else}
              <FileIcon />
            {/if}
            <span class="project-tree-label project-tree-label-{labelTone}">{row.node.name}</span>
            {#if fileChangeStatus}
              <span
                class={`project-tree-status-badge project-tree-status-${fileChangeStatus}`}
                title={`${fileChangeStatus} (git)`}
                aria-label={`${fileChangeStatus}`}
              >{fileStatusBadgeLabel(fileChangeStatus)}</span>
            {/if}
          </button>
        </li>
      {/if}
    {/each}
    {#if bottomPadPx > 0}
      <li class="project-tree-spacer" style={`height:${bottomPadPx}px`} aria-hidden="true"></li>
    {/if}
  </ul>
</div>

<style>
  .project-tree-view {
    min-height: 0;
    padding: var(--space-2);
  }

  .project-tree-view[data-dragging="true"] {
    cursor: grabbing;
  }

  .project-tree-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }

  .project-tree-spacer {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .project-tree-loading {
    list-style: none;
    color: var(--color-text-secondary);
    font-size: var(--font-size-status);
    padding: 0 var(--space-8);
    padding-left: calc(var(--space-8) + var(--node-depth, 1) * var(--tree-indent));
  }

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
    color: var(--color-diff-removed);
    background: color-mix(in srgb, var(--color-diff-removed) 16%, transparent);
  }
</style>
