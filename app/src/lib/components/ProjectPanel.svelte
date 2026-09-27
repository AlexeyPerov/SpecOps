<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import ProjectTreeView from "./ProjectTreeView.svelte";
  import ProjectTreeContextMenu from "./ProjectTreeContextMenu.svelte";
  import GitLogPopover from "./GitLogPopover.svelte";
  import { isGitIntegrationEnabled } from "../services/gitIntegrationSettings";
  import { openVersionControlAtCommit } from "../services/versionControlNavigation";
  import { appState } from "../state/appState";
  import { appSettings } from "../state/appStateSelectors";
  import type { ProjectTreeNode } from "../services/projectTree";
  import type { OpencodeFileChangeStatus } from "../ai/backends/workspaceAgentBackend";
  import type { PaneDropTargetElements } from "./paneDropTargets";
  import type { ContextId } from "../domain/contracts";
  import {
    DEFAULT_PROJECT_PANEL_WIDTH_PX,
    MAX_PANEL_WIDTH_PX,
    MIN_PANEL_WIDTH_PX,
    normalizePanelWidthPx,
  } from "../services/panelLayout";
  import { emptyMap, emptySet } from "../collections/emptyCollections";
  import { startPointerDrag } from "./pointerDrag";
  import { normalizePathSync } from "../services/diskFingerprint";
  import RefreshIcon from "./icons/RefreshIcon.svelte";

  interface Props {
    workspaceRoot: string;
    rootNodes?: ProjectTreeNode[];
    expandedPaths?: ReadonlySet<string>;
    childrenByPath?: ReadonlyMap<string, ProjectTreeNode[]>;
    loadingPaths?: ReadonlySet<string>;
    /**
     * Every openable file in the workspace, used by the `.md` filter to keep the
     * folders that contain Markdown files. Null while the list is not known yet
     * (still enumerating), so the filter keeps every folder instead of hiding
     * nested Markdown files.
     */
    markdownPaths?: readonly string[] | null;
    activeFilePath?: string | null;
    /** M5-T3 — git change status badges (absolute path → status). */
    statusByPath?: ReadonlyMap<string, OpencodeFileChangeStatus> | null;
    showHidden?: boolean;
    collapsed?: boolean;
    panelWidthPx?: number;
    onRefresh?: () => void;
    onToggleHidden?: (next: boolean) => void;
    onToggleCollapsed?: (next: boolean) => void;
    onPanelWidthChange?: (width: number) => void;
    onToggleDirectory?: (path: string) => void;
    onOpenFile?: (path: string) => void;
    /** Double click on a file row: keep its (preview) tab. */
    onKeepFile?: (path: string) => void;
    onMoveEntry?: (sourcePath: string, destDirPath: string) => Promise<void>;
    onNewFile?: (parentDirPath: string, name: string) => Promise<boolean>;
    onNewFolder?: (parentDirPath: string, name: string) => Promise<boolean>;
    onRenameEntry?: (path: string, kind: ProjectTreeNode["kind"]) => void;
    onDeleteEntry?: (path: string, kind: ProjectTreeNode["kind"]) => void;
    notify?: (message: string) => void;
    /** Phase 6 — live pane elements for file→pane DnD. */
    getPaneElements?: () => PaneDropTargetElements[];
    /** Phase 6 — open a file into a specific pane. */
    onOpenFileInPane?:
      | ((filePath: string, paneId: string) => void | Promise<void>)
      | null;
    /** Phase 6 — reports the hovered pane during a file drag (for affordance). */
    onFileDropPaneChange?: (paneId: string | null) => void;
    onOpenFileInContext?: (filePath: string, contextId: ContextId) => void | Promise<void>;
    onMarkdownFilterEnable?: () => void;
  }

  let {
    workspaceRoot,
    rootNodes = [],
    expandedPaths = emptySet<string>(),
    childrenByPath = emptyMap<string, ProjectTreeNode[]>(),
    loadingPaths = emptySet<string>(),
    markdownPaths = null,
    activeFilePath = null,
    statusByPath = null,
    showHidden = false,
    collapsed = false,
    panelWidthPx = DEFAULT_PROJECT_PANEL_WIDTH_PX,
    onRefresh = () => {},
    onToggleHidden = () => {},
    onToggleCollapsed = () => {},
    onPanelWidthChange = () => {},
    onToggleDirectory = () => {},
    onOpenFile = () => {},
    onKeepFile = () => {},
    onMoveEntry = async () => {},
    onNewFile = async () => false,
    onNewFolder = async () => false,
    onRenameEntry = () => {},
    onDeleteEntry = () => {},
    notify = () => {},
    getPaneElements = () => [],
    onOpenFileInPane = null,
    onFileDropPaneChange = () => {},
    onOpenFileInContext,
    onMarkdownFilterEnable = () => {},
  }: Props = $props();

  let panelBodyEl = $state<HTMLDivElement | null>(null);
  let contextMenuComponent = $state<ProjectTreeContextMenu | undefined>(undefined);
  let gitLogPopover = $state<GitLogPopover | undefined>(undefined);
  let displayWidth = $state(DEFAULT_PROJECT_PANEL_WIDTH_PX);
  let isResizing = $state(false);
  let markdownOnly = $state(false);
  let draft = $state<{
    kind: "file" | "directory";
    parentDirPath: string;
    defaultValue: string;
  } | null>(null);

  /**
   * Comparison keys of every folder that has a Markdown file somewhere below
   * it, or null while the workspace file list is still loading.
   */
  const markdownDirectoryKeys = $derived.by(() => {
    if (!markdownPaths) return null;
    const rootKey = normalizePathSync(workspaceRoot);
    const dirs = new Set<string>();
    for (const filePath of markdownPaths) {
      if (!filePath.toLowerCase().endsWith(".md")) continue;
      let cursor = normalizePathSync(filePath).replace(/\/[^/]+$/, "");
      while (cursor.length > rootKey.length && !dirs.has(cursor)) {
        dirs.add(cursor);
        const parent = cursor.replace(/\/[^/]+$/, "");
        if (parent === cursor) break;
        cursor = parent;
      }
    }
    return dirs;
  });

  $effect(() => {
    // The file list backing the filter is per workspace: switching workspaces
    // with the filter on must start enumerating the new one too.
    void workspaceRoot;
    if (markdownOnly) untrack(onMarkdownFilterEnable);
  });

  function filterNodes(nodes: readonly ProjectTreeNode[]): ProjectTreeNode[] {
    if (!markdownOnly) return [...nodes];
    const dirs = markdownDirectoryKeys;
    return nodes.filter((node) =>
      node.kind === "file"
        ? node.path.toLowerCase().endsWith(".md")
        : !dirs || dirs.has(normalizePathSync(node.path)),
    );
  }

  const visibleRootNodes = $derived(filterNodes(rootNodes));
  const visibleChildrenByPath = $derived.by(() => {
    if (!markdownOnly) return childrenByPath;
    const next = new Map<string, ProjectTreeNode[]>();
    for (const [path, nodes] of childrenByPath) next.set(path, filterNodes(nodes));
    return next;
  });

  function basename(path: string): string {
    const normalized = path.replaceAll("\\", "/");
    const parts = normalized.split("/");
    return parts[parts.length - 1] || path;
  }

  /** Last scroll offset the user was at, sampled before each tree re-render. */
  let userScrollTop = 0;
  /**
   * Active file whose row has already been scrolled into view. Deliberately not
   * reactive: the effect below both reads and writes it, and it exists purely
   * to make that effect idempotent.
   */
  let revealedActivePath: string | null = null;

  function handleBodyScroll(): void {
    const body = panelBodyEl;
    if (body) {
      userScrollTop = body.scrollTop;
    }
  }

  // Runs after every tree DOM patch (and when the active file changes).
  //
  // 1. Restores the scroll offset the browser clamped away. Deleting or moving
  //    an entry re-renders the list, and while it is briefly shorter the
  //    scroll container clamps `scrollTop` — which is what made the panel jump
  //    to the top after a delete/move.
  // 2. Reveals the active file only when it actually *changed*, retrying
  //    across tree updates while its row is still missing (auto-expanded
  //    ancestors land a tick later, M74). Revealing on every publish yanked
  //    the panel back to the active file on unrelated tree updates.
  $effect(() => {
    const path = activeFilePath;
    const body = panelBodyEl;
    void rootNodes;
    void childrenByPath;
    void expandedPaths;
    if (!body) {
      return;
    }
    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    if (body.scrollTop < userScrollTop && maxScrollTop >= userScrollTop) {
      body.scrollTop = userScrollTop;
    } else {
      userScrollTop = body.scrollTop;
    }
    if (!path) {
      revealedActivePath = null;
      return;
    }
    if (path === revealedActivePath) {
      return;
    }
    const node = body.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(path)}"]`,
    );
    if (!node) {
      // Not rendered yet (collapsed ancestor, or outside the virtualized
      // window — ProjectTreeView reveals those). Retry on the next update.
      return;
    }
    node.scrollIntoView({ block: "nearest" });
    userScrollTop = body.scrollTop;
    revealedActivePath = path;
  });

  $effect(() => {
    const synced = panelWidthPx;
    if (!isResizing) {
      displayWidth = normalizePanelWidthPx(synced);
    }
  });

  function clampPanelWidth(next: number): number {
    return Math.max(MIN_PANEL_WIDTH_PX, Math.min(MAX_PANEL_WIDTH_PX, next));
  }

  let activeResizeTeardown: (() => void) | null = null;

  function handleResizeStart(event: PointerEvent): void {
    if (collapsed) {
      return;
    }
    event.preventDefault();
    activeResizeTeardown?.();
    isResizing = true;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = displayWidth;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(pointerId);

    const teardown = startPointerDrag({
      pointerId,
      target,
      onMove: (moveEvent) => {
        const deltaX = startX - moveEvent.clientX;
        displayWidth = clampPanelWidth(startWidth + deltaX);
      },
      onEnd: () => {
        isResizing = false;
        activeResizeTeardown = null;
        onPanelWidthChange(displayWidth);
      },
    });

    activeResizeTeardown = () => {
      isResizing = false;
      teardown();
    };
  }

  onDestroy(() => {
    activeResizeTeardown?.();
    activeResizeTeardown = null;
    contextMenuComponent?.closeContextMenu();
    gitLogPopover?.closeGitLog();
  });

  // Reactive so toggling git integration in Settings updates the menu without
  // a remount.
  const gitEnabled = $derived(isGitIntegrationEnabled($appSettings.gitIntegration));

  function showGitLog(event: MouseEvent, path: string, isFile: boolean): void {
    gitLogPopover?.openGitLog(event, { path, isFile, label: basename(path) });
  }

  function openCommitInVersionControl(sha: string, repoRoot: string): void {
    openVersionControlAtCommit(
      appState.getActiveContext().id,
      repoRoot,
      sha,
      (message) => notify(message),
    );
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

  function startDraft(kind: "file" | "directory", parentDirPath: string): void {
    draft = {
      kind,
      parentDirPath,
      defaultValue: kind === "directory" ? "New Folder" : markdownOnly ? "untitled.md" : "untitled.txt",
    };
  }

  async function commitDraft(name: string): Promise<boolean> {
    if (!draft) return false;
    const created = draft.kind === "file"
      ? await onNewFile(draft.parentDirPath, name)
      : await onNewFolder(draft.parentDirPath, name);
    if (created) draft = null;
    return created;
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
      <button
        class="btn btn-sm btn-ghost project-panel-add"
        type="button"
        title="Create in project root"
        aria-label="Create file or folder"
        onclick={(event) => openContextMenu(event, { node: null, parentDirPath: workspaceRoot })}
      >+</button>
      <button class="btn btn-sm btn-ghost" type="button" onclick={onRefresh} title="Refresh tree">
        <RefreshIcon size={14} />
      </button>
      <button
        class={`btn btn-sm btn-ghost ${markdownOnly ? "project-panel-filter-active" : ""}`}
        type="button"
        aria-pressed={markdownOnly}
        title={markdownOnly ? "Show all files" : "Show Markdown files only"}
        onclick={() => {
          markdownOnly = !markdownOnly;
        }}
      >.md</button>
      <button
        class="btn btn-sm btn-ghost"
        type="button"
        onclick={() => onToggleHidden(!showHidden)}
        title={showHidden ? "Hide hidden files" : "Show hidden files"}
      >
        {showHidden ? "Hidden: On" : "Hidden: Off"}
      </button>
    {/if}
    <button
      class="btn btn-sm btn-ghost"
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
      onscroll={handleBodyScroll}
      oncontextmenu={handleContextMenuRoot}
    >
      <ProjectTreeView
        nodes={visibleRootNodes}
        {workspaceRoot}
        {expandedPaths}
        childrenByPath={visibleChildrenByPath}
        {loadingPaths}
        {activeFilePath}
        {statusByPath}
        {onToggleDirectory}
        {onOpenFile}
        {onKeepFile}
        onContextMenuRoot={handleContextMenuRoot}
        onContextMenuNode={handleContextMenuNode}
        {onMoveEntry}
        {notify}
        {getPaneElements}
        onOpenFileInPane={onOpenFileInPane ?? undefined}
        {onFileDropPaneChange}
        {onOpenFileInContext}
        {draft}
        onCommitDraft={commitDraft}
        onCancelDraft={() => (draft = null)}
      />
      <div class="project-panel-create-area" aria-hidden="true"></div>
    </div>
  {/if}
</aside>

<ProjectTreeContextMenu
  bind:this={contextMenuComponent}
  {workspaceRoot}
  {gitEnabled}
  onShowGitLog={showGitLog}
  onOpenFile={onOpenFile}
  onNewFile={(parent) => startDraft("file", parent)}
  onNewFolder={(parent) => startDraft("directory", parent)}
  onRename={onRenameEntry}
  onDelete={onDeleteEntry}
/>

<GitLogPopover bind:this={gitLogPopover} onOpenCommit={openCommitInVersionControl} />

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

  /* Muted ghost header buttons built on the shared .btn .btn-sm .btn-ghost
     base (U3.1); the resting color is muted to match the panel-title tone. */
  .project-panel-header .btn {
    color: var(--color-text-secondary);
  }

  .project-panel-header .btn:hover:not(:disabled) {
    color: var(--color-text-primary);
  }

  .project-panel-filter-active {
    color: var(--color-text-primary) !important;
    background: var(--color-pressed) !important;
  }

  .project-panel-body {
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
  }

  .project-panel-create-area {
    min-height: 28px;
    flex: 1 0 28px;
  }
</style>
