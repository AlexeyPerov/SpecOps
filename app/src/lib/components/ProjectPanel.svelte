<script lang="ts">
  import { onDestroy, untrack, tick } from "svelte";
  import { readDir } from "@tauri-apps/plugin-fs";
  import WorkspaceDocumentsLinks from "./WorkspaceDocumentsLinks.svelte";
  import ProjectFileFilterMenu from "./ProjectFileFilterMenu.svelte";
  import ProjectTreeView from "./ProjectTreeView.svelte";
  import ProjectTreeContextMenu from "./ProjectTreeContextMenu.svelte";
  import GitLogPopover from "./GitLogPopover.svelte";
  import { isGitIntegrationEnabled } from "../services/gitIntegrationSettings";
  import { openVersionControlAtCommit } from "../services/versionControlNavigation";
  import { appState } from "../state/appState";
  import { appSettings } from "../state/appStateSelectors";
  import type { ProjectTreeNode } from "../services/projectTree";
  import type { FileChangeStatus } from "../domain/fileChanges";
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
  import { loadProjectFavorites, setProjectFavorite, listenProjectFavorites } from "../services/projectFavorites";
  import { projectTreeChangeTones } from "../services/projectTreeDecorations";
  import { fileStatusBadgeLabel } from "../services/fileStatusTracker";
  import { workspaceRelativePath } from "../services/workspacePaths";
  import { flattenProjectTree } from "../services/projectTreeFlatten";
  import { selectProjectPaths } from "../services/projectSelection";
  import { moveProjectEntries, deleteProjectEntries } from "../services/projectBulkOperations";
  import type { PromptAnchor } from "../services/promptAnchor";
  import { createProjectTypeFilter, filterProjectNodes, type ProjectFileFilter, type ProjectFilterSnapshot } from "../services/projectTypeFilter";
  import { createProjectSizes, projectSizeLabel, projectSizeTitle, type ProjectSizeMode, type ProjectSizeEntry } from "../services/projectSizes";
  import { subscribeProjectPaneChanges } from "../services/projectPaneChanges";
  import type { WorkspaceListEntry } from "../services/workspaceTraversal";
  import RefreshIcon from "./icons/RefreshIcon.svelte";
  import SearchIcon from "./icons/SearchIcon.svelte";

  interface Props {
    workspaceRoot: string;
    rootNodes?: ProjectTreeNode[];
    expandedPaths?: ReadonlySet<string>;
    childrenByPath?: ReadonlyMap<string, ProjectTreeNode[]>;
    loadingPaths?: ReadonlySet<string>;
    readProjectDirectory?: (path: string) => Promise<WorkspaceListEntry[]>;
    activeFilePath?: string | null;
    /** M5-T3 — git change status badges (absolute path → status). */
    statusByPath?: ReadonlyMap<string, FileChangeStatus> | null;
    showHidden?: boolean;
    collapsed?: boolean;
    panelWidthPx?: number;
    onRefresh?: () => void;
    /** Opens the Find-in-Project panel scoped to this workspace. */
    onOpenSearch?: () => void;
    onToggleHidden?: (next: boolean) => void;
    onToggleCollapsed?: (next: boolean) => void;
    onPanelWidthChange?: (width: number) => void;
    onCollapseAll?: () => void;
    onToggleDirectory?: (path: string) => void | Promise<void>;
    onOpenFile?: (path: string) => void;
    /** Double click on a file row: keep its (preview) tab. */
    onKeepFile?: (path: string) => void;
    onMoveEntry?: (sourcePath: string, destDirPath: string) => Promise<void>;
    onNewFile?: (parentDirPath: string, name: string) => Promise<boolean>;
    onNewFolder?: (parentDirPath: string, name: string) => Promise<boolean>;
    /** Inline rename; resolves false to keep the row editing (e.g. name taken). */
    onRenameEntry?: (path: string, kind: ProjectTreeNode["kind"], name: string) => Promise<boolean>;
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
  }

  let {
    workspaceRoot,
    rootNodes = [],
    expandedPaths = emptySet<string>(),
    childrenByPath = emptyMap<string, ProjectTreeNode[]>(),
    loadingPaths = emptySet<string>(),
    readProjectDirectory,
    activeFilePath = null,
    statusByPath = null,
    showHidden = false,
    collapsed = false,
    panelWidthPx = DEFAULT_PROJECT_PANEL_WIDTH_PX,
    onRefresh = () => {},
    onOpenSearch = () => {},
    onToggleHidden = () => {},
    onToggleCollapsed = () => {},
    onPanelWidthChange = () => {},
    onCollapseAll = () => {},
    onToggleDirectory = () => {},
    onOpenFile = () => {},
    onKeepFile = () => {},
    onMoveEntry = async () => {},
    onNewFile = async () => false,
    onNewFolder = async () => false,
    onRenameEntry = async () => true,
    notify = () => {},
    getPaneElements = () => [],
    onOpenFileInPane = null,
    onFileDropPaneChange = () => {},
    onOpenFileInContext,
  }: Props = $props();

  let multipleSelection = $state(false);
  let selectedPaths = $state<Set<string>>(new Set());
  let selectionAnchor = $state<string | null>(null);
  let mutationRunning = $state(false);
  $effect(() => { void workspaceRoot; multipleSelection = false; selectedPaths = new Set(); selectionAnchor = null; });
  function clearSelection(): void {
    multipleSelection = false;
    selectedPaths = new Set();
    selectionAnchor = null;
  }
  function selectPath(event: MouseEvent, path: string, visiblePaths: string[]): void {
    const next = selectProjectPaths(selectedPaths, selectionAnchor, path, visiblePaths, { shift: event.shiftKey, toggle: multipleSelection || event.metaKey || event.ctrlKey });
    selectedPaths = next.paths; selectionAnchor = next.anchor;
  }
  /** Viewport rect around the visible rows of `entries`, clipped to the tree's scroll area. */
  function visibleRowsRect(entries: readonly ProjectTreeNode[]): PromptAnchor | undefined {
    const body = panelBodyEl;
    if (!body) return undefined;
    const paths = new Set(entries.map((entry) => entry.path));
    const bounds = body.getBoundingClientRect();
    let rect: PromptAnchor | undefined;
    for (const row of body.querySelectorAll<HTMLElement>("[data-path]")) {
      if (!paths.has(row.dataset.path ?? "")) continue;
      const r = row.getBoundingClientRect();
      const top = Math.max(r.top, bounds.top);
      const bottom = Math.min(r.bottom, bounds.bottom);
      if (bottom <= top) continue;
      rect = rect
        ? { left: Math.min(rect.left, r.left), top: Math.min(rect.top, top), right: Math.max(rect.right, r.right), bottom: Math.max(rect.bottom, bottom) }
        : { left: r.left, top, right: r.right, bottom };
    }
    return rect;
  }
  async function mutateSelected(kind: "move" | "delete", entries: readonly ProjectTreeNode[]): Promise<void> {
    if (mutationRunning) return;
    mutationRunning = true;
    const root = workspaceRoot;
    try {
      if (kind === "move") await moveProjectEntries(root, entries, notify);
      else await deleteProjectEntries(root, entries, notify, visibleRowsRect(entries));
      if (workspaceRoot === root) selectedPaths = new Set();
      onRefresh();
    } catch (error) { notify(String(error)); }
    finally { mutationRunning = false; }
  }
  async function favoriteSelected(entries: readonly ProjectTreeNode[], favorite: boolean): Promise<void> {
    const root = workspaceRoot;
    try {
      for (const node of entries) await setProjectFavorite(root, node, favorite);
      if (workspaceRoot === root) await reloadFavorites?.();
    } catch (error) { notify(String(error)); }
  }

  const changeTones = $derived(projectTreeChangeTones(statusByPath));
  let favoriteRevealPath = $state<string | null>(null);
  let treeActionsEl = $state<HTMLDetailsElement | null>(null);
  $effect(() => {
    void activeFilePath;
    untrack(() => { favoriteRevealPath = null; });
  });
  let favorites = $state<ProjectTreeNode[]>([]);
  let reloadFavorites = $state<(() => Promise<void>) | null>(null);
  let favoritesCollapsed = $state(false);
  const favoritePaths = $derived(new Set(favorites.map((node) => normalizePathSync(node.path))));
  $effect(() => {
    const root = workspaceRoot;
    favorites = [];
    reloadFavorites = null;
    favoriteRevealPath = null;
    let disposed = false;
    let revision = 0;
    let stop: (() => void) | undefined;
    const reload = async () => {
      const request = ++revision;
      try {
        const entries = await loadProjectFavorites(root);
        if (!disposed && request === revision) favorites = entries;
      } catch { if (!disposed) notify("Could not load project favorites."); }
    };
    void listenProjectFavorites(root, () => { void reload(); }).then((unlisten) => {
      if (disposed) unlisten();
      else { stop = unlisten; reloadFavorites = reload; void reload(); }
    }).catch(() => { void reload(); });
    return () => { disposed = true; stop?.(); };
  });
  // Tree listings change on every expand and watcher flush; coalesce the
  // favorites re-check (a file read plus one exists() per favorite) per burst.
  $effect(() => {
    void rootNodes;
    void childrenByPath;
    const reload = reloadFavorites;
    if (!reload) return;
    const timer = setTimeout(() => untrack(() => { void reload(); }), 500);
    return () => clearTimeout(timer);
  });
  async function toggleFavorite(node: ProjectTreeNode): Promise<void> {
    const root = workspaceRoot;
    try {
      await setProjectFavorite(root, node, !favoritePaths.has(normalizePathSync(node.path)));
      if (workspaceRoot === root) await reloadFavorites?.();
    } catch { notify("Could not save project favorites."); }
  }
  function expandOneLevel(): void {
    const targets: string[] = [];
    function visit(nodes: readonly ProjectTreeNode[]): void {
      for (const node of nodes) {
        if (node.kind !== "directory") continue;
        if (!expandedPaths.has(node.path)) targets.push(node.path);
        else visit(visibleChildrenByPath.get(node.path) ?? []);
      }
    }
    visit(visibleRootNodes);
    for (const path of targets) onToggleDirectory(path);
  }
  async function openFavorite(node: ProjectTreeNode): Promise<void> {
    if (node.kind === "file") { onOpenFile(node.path); return; }
    const relative = workspaceRelativePath(node.path, workspaceRoot);
    if (relative === null) return;
    let path = workspaceRoot.replace(/\/+$/, "");
    for (const segment of relative.split("/")) {
      path += `/${segment}`;
      if (!expandedPaths.has(path)) await onToggleDirectory(path);
    }
    favoriteRevealPath = null;
    await tick();
    favoriteRevealPath = node.path;
    const target = node.path;
    requestAnimationFrame(() => {
      const row = [...(panelBodyEl?.querySelectorAll<HTMLElement>("[data-path]") ?? [])]
        .find((element) => element.dataset.path === target);
      row?.scrollIntoView({ block: "nearest" });
      row?.focus();
    });
  }

  let panelBodyEl = $state<HTMLDivElement | null>(null);
  let contextMenuComponent = $state<ProjectTreeContextMenu | undefined>(undefined);
  let gitLogPopover = $state<GitLogPopover | undefined>(undefined);
  let displayWidth = $state(DEFAULT_PROJECT_PANEL_WIDTH_PX);
  let isResizing = $state(false);
  let fileFilter = $state<ProjectFileFilter>("all");
  let sizeMode = $state<ProjectSizeMode>("off");
  let sizeEntries = $state.raw<ReadonlyMap<string, ProjectSizeEntry>>(new Map());
  let filterSnapshot = $state.raw<ProjectFilterSnapshot>({ directories: null, unknownDirectories: [], loading: false, incomplete: false });
  let paneVisible = $state(true);
  const rootSize = $derived(sizeEntries.get(normalizePathSync(workspaceRoot).replace(/\/+$/, "")));
  const typeFilter = createProjectTypeFilter({
    readDir: (path) => (readProjectDirectory ?? readDir)(path),
    publish: (snapshot) => { filterSnapshot = snapshot; },
  });
  const sizes = createProjectSizes({ publish: (entries) => { sizeEntries = entries; }, notify: (message) => notify(message) });
  $effect(() => { typeFilter.configure(workspaceRoot, fileFilter, showHidden, !collapsed && paneVisible); });
  $effect(() => { sizes.configure(workspaceRoot, sizeMode, !collapsed && paneVisible); });
  $effect(() => {
    const visibility = () => { paneVisible = !document.hidden; };
    const focus = () => { if (!document.hidden) sizes.refresh(); };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", focus);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", focus); };
  });
  const unsubscribePaneChanges = subscribeProjectPaneChanges((path, kind) => {
    typeFilter.changed(path, kind);
    sizes.changed(path);
  });
  onDestroy(() => { unsubscribePaneChanges(); typeFilter.dispose(); sizes.dispose(); });
  function refreshPane(): void {
    onRefresh();
    typeFilter.refresh();
    sizes.refresh();
  }
  function calculateFolderSize(path: string): void {
    sizeMode = "folders";
    sizes.configure(workspaceRoot, "folders", !collapsed && paneVisible);
    void sizes.calculate(path);
  }
  let draft = $state<{
    kind: "file" | "directory";
    parentDirPath: string;
    defaultValue: string;
  } | null>(null);
  let renaming = $state<{ path: string; kind: ProjectTreeNode["kind"] } | null>(null);
  $effect(() => { void workspaceRoot; renaming = null; });
  async function commitRename(name: string): Promise<boolean> {
    const target = renaming;
    if (!target) return true;
    const currentName = target.path.replaceAll("\\", "/").split("/").pop() ?? target.path;
    if (name === currentName) { renaming = null; return true; }
    const renamed = await onRenameEntry(target.path, target.kind, name);
    if (renamed && renaming === target) renaming = null;
    return renamed;
  }

  function filterNodes(nodes: readonly ProjectTreeNode[]): ProjectTreeNode[] {
    return filterProjectNodes(nodes, fileFilter, filterSnapshot);
  }
  const visibleRootNodes = $derived(filterNodes(rootNodes));
  const visibleChildrenByPath = $derived.by(() => {
    if (fileFilter === "all") return childrenByPath;
    const next = new Map<string, ProjectTreeNode[]>();
    for (const [path, nodes] of childrenByPath) next.set(path, filterNodes(nodes));
    return next;
  });

  const selectedNodes = $derived(flattenProjectTree(visibleRootNodes, expandedPaths, visibleChildrenByPath, loadingPaths)
    .flatMap((row) => row.kind === "node" && selectedPaths.has(row.node.path) ? [row.node] : []));

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
    if (!selectedPaths.has(node.path)) { selectedPaths = new Set([node.path]); selectionAnchor = node.path; }
    contextMenuComponent?.openContextMenu(event, { node, parentDirPath, nodes: selectedNodes.some((entry) => entry.path === node.path) ? selectedNodes : [node] });
  }

  function startDraft(kind: "file" | "directory", parentDirPath: string): void {
    renaming = null;
    draft = {
      kind,
      parentDirPath,
      defaultValue: kind === "directory" ? "New Folder" : fileFilter === "markdown" ? "untitled.md" : "untitled.txt",
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

<svelte:window
  onkeydown={(event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (treeActionsEl?.open) treeActionsEl.removeAttribute("open");
    else if (multipleSelection) clearSelection();
  }}
  onpointerdown={(event) => { if (event.target instanceof Node && !treeActionsEl?.contains(event.target)) treeActionsEl?.removeAttribute("open"); }}
/>

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
  <header class="project-panel-header" class:project-panel-header-compact={displayWidth < 300}>
    {#if !collapsed}
      <div class="project-panel-title" title={workspaceRoot}>{basename(workspaceRoot)}</div>
      <button
        class="btn btn-sm btn-ghost"
        type="button"
        onclick={onOpenSearch}
        title="Find in project (Cmd+Shift+F)"
      >
        <SearchIcon size={14} />
      </button>
      <button
        class="btn btn-sm btn-ghost project-panel-add"
        type="button"
        title="Create in project root"
        aria-label="Create file or folder"
        onclick={(event) => openContextMenu(event, { node: null, parentDirPath: workspaceRoot })}
      >+</button>
      <details class="tree-actions" bind:this={treeActionsEl}>
        <summary class="btn btn-sm btn-ghost" title="Tree actions" aria-label="Tree actions">⋯</summary>
        <div class="tree-actions-menu">
          <button type="button" onclick={(event) => { expandOneLevel(); event.currentTarget.closest("details")?.removeAttribute("open"); }}>Expand one level</button>
          <button type="button" disabled={expandedPaths.size === 0} onclick={(event) => { onCollapseAll(); event.currentTarget.closest("details")?.removeAttribute("open"); }}>Collapse all</button>
          <button type="button" aria-pressed={multipleSelection} onclick={() => { multipleSelection = !multipleSelection; selectedPaths = new Set(); selectionAnchor = null; treeActionsEl?.removeAttribute("open"); }}>{multipleSelection ? "Exit multiple selection" : "Select multiple items"}</button>
          <label class="project-size-mode">File sizes
            <select aria-label="Project file sizes" bind:value={sizeMode}>
              <option value="off">Off</option>
              <option value="files">Files</option>
              <option value="folders">Files and folders</option>
            </select>
          </label>

        </div>
      </details>
      <button class="btn btn-sm btn-ghost" type="button" onclick={refreshPane} title="Refresh tree">
        <RefreshIcon size={14} />
      </button>
      <ProjectFileFilterMenu value={fileFilter} onSelect={(value) => { fileFilter = value; }} />
      <button
        class="btn btn-sm btn-ghost"
        type="button"
        onclick={() => onToggleHidden(!showHidden)}
        aria-pressed={showHidden}
        class:project-panel-hidden-active={showHidden}
        aria-label={showHidden ? "Hide hidden files" : "Show hidden files"}
        title={showHidden ? "Hide hidden files" : "Show hidden files"}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8Z" stroke="currentColor" stroke-width="1.2" />
          <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2" />
          {#if !showHidden}<path d="m2 2 12 12" stroke="currentColor" stroke-width="1.2" />{/if}
        </svg>
      </button>
    {/if}
    <button
      class="btn btn-sm btn-ghost project-panel-collapse"
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
      {#if fileFilter !== "all" && (filterSnapshot.loading || filterSnapshot.incomplete)}
        <div class="project-filter-status" role="status">{filterSnapshot.loading ? "Finding matching files…" : "Some folders could not be indexed; results may be incomplete."}</div>
      {/if}
      {#if sizeMode === "folders" && rootSize}
        <div class="project-root-size" title={projectSizeTitle(rootSize)}>
          <span>Project size: {projectSizeLabel(rootSize)}</span>
          <button type="button" class="btn btn-sm btn-ghost" onclick={() => rootSize.loading ? sizes.cancel(workspaceRoot) : calculateFolderSize(workspaceRoot)}>{rootSize.loading ? "Cancel" : "Recalculate"}</button>
        </div>
      {/if}
      {#if multipleSelection || selectedNodes.length > 1}
        <div class="project-selection-bar">
          <span role="status">{selectedNodes.length} selected</span>
          <button type="button" class="btn btn-sm btn-ghost" onclick={clearSelection}>Done</button>
        </div>
      {/if}
      <WorkspaceDocumentsLinks root={workspaceRoot} refreshToken={rootNodes} />
      {#if favorites.length > 0}
        <section class="project-favorites" aria-label="Favorites">
          <button class="favorites-heading" type="button" aria-expanded={!favoritesCollapsed} onclick={() => favoritesCollapsed = !favoritesCollapsed}>
            {favoritesCollapsed ? "▸" : "▾"} Favorites
          </button>
          {#if !favoritesCollapsed}
            {#each favorites as node (node.path)}
              {@const tone = changeTones.get(normalizePathSync(node.path))}
              {@const status = statusByPath?.get(node.path)}
              <div class="favorite-row">
                <button class="favorite-link" type="button" title={node.path} onclick={() => { void openFavorite(node); }} oncontextmenu={(event) => handleContextMenuNode(event, node)}>
                  <span class="favorite-star" aria-hidden="true">★</span>
                  <span class:favorite-pending={tone === "pending"} class:favorite-conflicted={tone === "conflicted"}>{node.name}{node.kind === "directory" ? "/" : ""}</span>
                  {#if status}<span class:favorite-pending={tone === "pending"} class:favorite-conflicted={tone === "conflicted"} title={`${status} (git)`}>{fileStatusBadgeLabel(status)}</span>{/if}
                  <small>{workspaceRelativePath(node.path, workspaceRoot)}</small>
                </button>
                <button class="favorite-remove" type="button" title="Remove from Favorites" aria-label={`Remove ${node.name} from Favorites`} onclick={() => { void toggleFavorite(node); }}>×</button>
              </div>
            {/each}
          {/if}
        </section>
      {/if}
      <ProjectTreeView
        {selectedPaths}
        {multipleSelection}
        onSelectPath={selectPath}
        onSelectAll={(paths) => { selectedPaths = new Set(paths); selectionAnchor = paths[0] ?? null; }}
        onClearSelection={clearSelection}
        coloredFileIcons={$appSettings.coloredProjectFileIcons}
        nodes={visibleRootNodes}
        {workspaceRoot}
        {expandedPaths}
        childrenByPath={visibleChildrenByPath}
        {loadingPaths}
        {activeFilePath}
        {statusByPath}
        {favoritePaths}
        {sizeMode}
        {sizeEntries}
        onVisibleFiles={(paths) => sizes.visibleFiles(paths)}
        revealPath={favoriteRevealPath}
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
        renamingPath={renaming?.path ?? null}
        onCommitRename={commitRename}
        onCancelRename={() => (renaming = null)}
      />
      <div class="project-panel-create-area" aria-hidden="true"></div>
    </div>
  {/if}
</aside>

<ProjectTreeContextMenu
  bind:this={contextMenuComponent}
  {workspaceRoot}
  {gitEnabled}
  {favoritePaths}
  onToggleFavorite={(node) => { void toggleFavorite(node); }}
  onShowGitLog={showGitLog}
  onOpenFile={onOpenFile}
  onNewFile={(parent) => startDraft("file", parent)}
  onNewFolder={(parent) => startDraft("directory", parent)}
  onRename={(path, kind) => { draft = null; renaming = { path, kind }; }}
  onCalculateFolderSize={calculateFolderSize}
  onCancelFolderSize={(path) => sizes.cancel(path)}
  {sizeEntries}
  busy={mutationRunning}
  onMoveSelected={(entries) => { void mutateSelected("move", entries); }}
  onDeleteSelected={(entries) => { void mutateSelected("delete", entries); }}
  onFavoriteSelected={(entries, favorite) => { void favoriteSelected(entries, favorite); }}
  {notify}
/>

<GitLogPopover bind:this={gitLogPopover} onOpenCommit={openCommitInVersionControl} />

<style>
  .project-root-size { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; font-size: 11px; color: var(--color-text-secondary); }
  .project-selection-bar { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; font-size: 11px; color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border-subtle); }
  .project-panel-header .project-panel-hidden-active { color: var(--color-text-primary); background: var(--color-hover); }
  .project-panel-header-compact .btn { padding-inline: 2px; }
  .project-size-mode { display: flex; flex-direction: column; gap: 4px; padding: 6px; color: var(--color-text-primary); }
  .project-size-mode select { font: inherit; color: inherit; background: var(--color-surface-1); }
  .project-filter-status { padding: 6px; font-size: 11px; color: var(--color-text-secondary); }

  .tree-actions { position: relative; }
  .tree-actions summary { list-style: none; cursor: pointer; }
  .tree-actions summary::-webkit-details-marker { display: none; }
  .tree-actions-menu { position: absolute; right: 0; top: 100%; z-index: 20; min-width: 165px; padding: 4px; background: var(--color-surface-1); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); box-shadow: var(--shadow-overlay); }
  .tree-actions-menu button { display: block; width: 100%; padding: 6px; text-align: left; border: 0; background: transparent; color: var(--color-text-primary); font: inherit; cursor: pointer; }
  .tree-actions-menu button:hover { background: var(--color-hover); }
  .tree-actions-menu button:disabled { opacity: .45; cursor: default; }
  .project-favorites { border-bottom: 1px solid var(--color-border-subtle); padding: var(--space-4); }
  .favorites-heading, .favorite-link, .favorite-remove { border: 0; background: transparent; color: var(--color-text-primary); font: inherit; cursor: pointer; }
  .favorites-heading { width: 100%; text-align: left; padding: 4px; color: var(--color-text-secondary); }
  .favorite-row { display: flex; align-items: center; }
  .favorite-row:hover { background: var(--color-hover); }
  .favorite-link { display: flex; gap: 6px; flex: 1; min-width: 0; align-items: center; text-align: left; padding: 4px; }
  .favorite-link span, .favorite-link small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .favorite-link small { color: var(--color-text-secondary); font-size: 10px; flex: 1; }
  .favorite-star { color: var(--project-pane-color-favorite); flex-shrink: 0; }
  .favorite-pending { color: var(--project-pane-color-pending); }
  .favorite-conflicted { color: var(--color-danger); }
  .favorite-remove { padding: 4px; }

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
    min-height: var(--tab-header-height);
    border-bottom: 1px solid var(--color-border-subtle);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 6px;
    min-width: 0;
  }

  .project-panel-collapsed .project-panel-header { padding: 0; }

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
