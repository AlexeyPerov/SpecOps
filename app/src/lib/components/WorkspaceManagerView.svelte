<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { ContextId, WorkspaceEntry } from "../domain/contracts";
  import {
    loadWorkspaceGitColumnCell,
    subscribeWorkspaceGitColumnAutoRefresh,
    type WorkspaceGitColumnCell,
  } from "../git/workspaceManagerGitColumn";
  import { shouldLoadWorkspaceManagerGitColumn } from "../git/gitIntegrationGating";
  import { mapWithConcurrency } from "../services/mapWithConcurrency";
  import { emptySet } from "../collections/emptyCollections";
  import { getProjectCatalog, loadProjectCatalog, projectIdentity, subscribeProjectCatalog } from '../services/workspaceCatalog';
  import { addWorkspaceToWindow } from '../services/addWorkspaceToWindow';
  import EmptyState from "./EmptyState.svelte";

  /** The catalog owns membership; open entries retain their window context actions. */
  type ManagerRow = { id: string; rootPath: string; name: string; contextId?: ContextId; openError?: string };
  let {
    workspaces = [],
    activeContextId = "notepad",
    hiddenRootPaths = emptySet<string>(),
    onAddWorkspace = () => {},
    onAddMultiple = () => {},
    onSelectWorkspace = (_workspaceId: ContextId) => {},
    onOpenWorkspaceSettings = (_workspaceId: ContextId) => {},
    onOpenVersionControl = (_workspaceId: ContextId) => {},
  }: {
    workspaces?: WorkspaceEntry[];
    activeContextId?: ContextId;
    /** Normalized root paths currently hidden from the activity rail. */
    hiddenRootPaths?: Set<string>;
    onAddWorkspace?: () => void;
    onAddMultiple?: () => void;
    onSelectWorkspace?: (workspaceId: ContextId) => void;
    onOpenWorkspaceSettings?: (workspaceId: ContextId) => void;
    onOpenVersionControl?: (workspaceId: ContextId) => void;
  } = $props();

  let catalog = $state(getProjectCatalog());
  let catalogError = $state('');
  const rows: ManagerRow[] = $derived.by(() => {
    const projects = new Map<string, ManagerRow>(Object.values(catalog.projects)
      .sort((a, b) => a.order - b.order)
      .map(project => [project.id, { ...project }]));
    for (const workspace of workspaces) {
      const id = projectIdentity(workspace.rootPath);
      projects.set(id, { ...projects.get(id), id, rootPath: workspace.rootPath,
        name: projects.get(id)?.name ?? workspace.rootPath.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? workspace.rootPath,
        contextId: workspace.id });
    }
    return [...projects.values()];
  });
  onMount(() => {
    const unsubscribe = subscribeProjectCatalog(next => { catalog = next; });
    void loadProjectCatalog().catch(error => { catalogError = String(error); });
    return unsubscribe;
  });
  async function selectProject(workspace: ManagerRow): Promise<void> {
    if (workspace.contextId) { onSelectWorkspace(workspace.contextId); return; }
    try {
      const id = await addWorkspaceToWindow(workspace.rootPath);
      if (id) onSelectWorkspace(id);
      catalogError = '';
    } catch (error) { catalogError = String(error); }
  }

  const gitRootsKey = $derived(JSON.stringify(rows.map(row => row.rootPath)));

  let gitCellsByPath = $state<Map<string, WorkspaceGitColumnCell>>(new Map());
  let gitRefreshBusy = $state(false);
  /** Bumped on each batch load start / effect cleanup so stale writes are dropped. */
  let gitLoadGeneration = 0;
  const showGitColumn = $derived(shouldLoadWorkspaceManagerGitColumn());

  function gitErrorCell(error: unknown): WorkspaceGitColumnCell {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", text: "Git error", message };
  }

  function isHidden(workspace: ManagerRow): boolean {
    return hiddenRootPaths.has(projectIdentity(workspace.rootPath));
  }

  function gitCellForWorkspace(workspace: ManagerRow): WorkspaceGitColumnCell {
    return gitCellsByPath.get(workspace.rootPath) ?? { status: "loading" };
  }

  function gitCellDisplayText(cell: WorkspaceGitColumnCell): string {
    if (cell.status === "ready") {
      return cell.displayText;
    }
    if (cell.status === "loading") {
      return "…";
    }
    return cell.text;
  }

  function gitCellTitle(cell: WorkspaceGitColumnCell): string {
    if (cell.status === "ready") {
      const summary = cell.summary;
      const branch = summary.isDetached ? `Detached HEAD at ${summary.branchName}` : summary.branchName;
      const tracking = summary.aheadBehindError
        ? `Could not load tracking: ${summary.aheadBehindError}`
        : summary.aheadBehind && (summary.aheadBehind.ahead > 0 || summary.aheadBehind.behind > 0)
          ? `${summary.aheadBehind.ahead} ahead, ${summary.aheadBehind.behind} behind`
          : summary.aheadBehind
            ? "Up to date with upstream"
            : "No upstream";
      const tree = summary.isDirty ? "Working tree has uncommitted changes" : "Working tree clean";
      return `${branch} · ${tracking} · ${tree}`;
    }
    if (cell.status === "neutral") {
      return "Not a git repository";
    }
    if (cell.status === "error") {
      return cell.message;
    }
    return "Loading git status…";
  }

  async function loadGitCellsForWorkspaces(
    rows: Pick<ManagerRow, 'rootPath'>[],
    options?: { force?: boolean },
  ): Promise<void> {
    const generation = ++gitLoadGeneration;

    if (!showGitColumn) {
      if (generation !== gitLoadGeneration) {
        return;
      }
      gitCellsByPath = new Map();
      return;
    }
    if (rows.length === 0) {
      if (generation !== gitLoadGeneration) {
        return;
      }
      gitCellsByPath = new Map();
      return;
    }

    const pending = new Map(untrack(() => gitCellsByPath));
    for (const workspace of rows) {
      if (!options?.force && pending.has(workspace.rootPath)) {
        continue;
      }
      pending.set(workspace.rootPath, { status: "loading" });
    }
    gitCellsByPath = pending;

    const results = new Map<string, WorkspaceGitColumnCell>();
    try {
      // Per-path catch so one failure does not leave the whole batch on "…".
      // P03-08-07: bound concurrent git processes (previously Promise.all fired
      // one load per row — up to 2N blocking subprocesses for N workspaces,
      // which saturated the tokio pool shared with file reads). The per-repo
      // queue still serializes same-repo work; this caps cross-repo fan-out.
      const ordered = await mapWithConcurrency(rows, 4, async (workspace) => {
        try {
          const cell = await loadWorkspaceGitColumnCell(workspace.rootPath, {
            force: options?.force,
          });
          return [workspace.rootPath, cell] as const;
        } catch (error) {
          return [workspace.rootPath, gitErrorCell(error)] as const;
        }
      });
      for (const [path, cell] of ordered) {
        results.set(path, cell);
      }
    } catch (error) {
      if (generation !== gitLoadGeneration) {
        return;
      }
      const next = new Map(untrack(() => gitCellsByPath));
      for (const workspace of rows) {
        const cell = next.get(workspace.rootPath);
        if (!cell || cell.status === "loading") {
          next.set(workspace.rootPath, gitErrorCell(error));
        }
      }
      gitCellsByPath = next;
      return;
    }

    if (generation !== gitLoadGeneration) {
      return;
    }

    const next = new Map(untrack(() => gitCellsByPath));
    for (const [path, cell] of results) {
      next.set(path, cell);
    }
    gitCellsByPath = next;
  }

  async function handleRefreshGitColumn(): Promise<void> {
    if (gitRefreshBusy || rows.length === 0) {
      return;
    }

    gitRefreshBusy = true;
    try {
      await loadGitCellsForWorkspaces(rows, { force: true });
    } finally {
      gitRefreshBusy = false;
    }
  }

  async function refreshGitColumnCell(workspaceRootPath: string): Promise<void> {
    const generation = gitLoadGeneration;
    gitCellsByPath = new Map(gitCellsByPath).set(workspaceRootPath, { status: "loading" });
    try {
      const cell = await loadWorkspaceGitColumnCell(workspaceRootPath, { force: true });
      if (generation !== gitLoadGeneration) {
        return;
      }
      gitCellsByPath = new Map(gitCellsByPath).set(workspaceRootPath, cell);
    } catch (error) {
      if (generation !== gitLoadGeneration) {
        return;
      }
      gitCellsByPath = new Map(gitCellsByPath).set(workspaceRootPath, gitErrorCell(error));
    }
  }

  $effect(() => {
    const paths = new Set<string>(JSON.parse(gitRootsKey));
    return subscribeWorkspaceGitColumnAutoRefresh((workspaceRootPath) => {
      if (!paths.has(workspaceRootPath)) {
        return;
      }
      void refreshGitColumnCell(workspaceRootPath);
    });
  });

  $effect(() => {
    const roots: string[] = JSON.parse(gitRootsKey);
    void loadGitCellsForWorkspaces(roots.map(rootPath => ({ rootPath })));
    return () => {
      gitLoadGeneration += 1;
    };
  });
</script>

<div class="workspace-manager-view" role="tabpanel" aria-label="Workspace Manager">
  <header class="workspace-manager-header">
    <div class="workspace-manager-heading">
      <h2>Workspaces</h2>
      <p class="workspace-manager-subtitle">
        All registered projects. Click a row to open or switch.
      </p>
    </div>
    <div class="workspace-manager-actions">
      {#if showGitColumn}
      <button
        type="button"
        class="btn btn-secondary"
        disabled={gitRefreshBusy || rows.length === 0}
        title="Refresh git status column"
        onclick={handleRefreshGitColumn}
      >
        {gitRefreshBusy ? "Refreshing…" : "Refresh git"}
      </button>
      {/if}
      <button type="button" class="btn btn-secondary" onclick={onAddWorkspace}>Add workspace</button>
      <button type="button" class="btn btn-secondary" onclick={onAddMultiple}>Add multiple…</button>
    </div>
  </header>

  {#if catalogError}<p role="alert">{catalogError}</p>{/if}
  {#if rows.length === 0}
    <EmptyState
      class="workspace-manager-empty"
      title="No projects registered"
      description="Add a project to your catalog."
    >
      {#snippet actions()}
        <div class="workspace-manager-actions">
          <button type="button" class="btn btn-secondary" onclick={onAddWorkspace}>Add workspace</button>
          <button type="button" class="btn btn-secondary" onclick={onAddMultiple}>Add multiple…</button>
        </div>
      {/snippet}
    </EmptyState>
  {:else}
    <table class="workspace-manager-table">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Path</th>
          {#if showGitColumn}
          <th scope="col">Git</th>
          {/if}
          <th scope="col" class="wm-action-col"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as workspace (workspace.id)}
          {@const hidden = isHidden(workspace)}
          {@const gitCell = gitCellForWorkspace(workspace)}
          <tr
            class="wm-row"
            class:wm-row-active={activeContextId === workspace.contextId}
            class:wm-row-hidden={hidden}
            onclick={() => void selectProject(workspace)}
            onkeydown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void selectProject(workspace);
              }
            }}
            tabindex="0"
          >
            <td class="wm-name">{workspace.name}</td>
            <td class="wm-path">
              <span class="wm-path-text" title={workspace.rootPath}>{workspace.rootPath}</span>
              {#if !workspace.contextId}<span class="wm-hidden-hint">(closed or in another window)</span>{/if}
              {#if workspace.openError}<span class="wm-hidden-hint" title={workspace.openError}>Unavailable: {workspace.openError}</span>{/if}
              {#if hidden}
                <span class="wm-hidden-hint">(hidden from sidebar)</span>
              {/if}
            </td>
            {#if showGitColumn}
            <td class="wm-git">
              <span
                class="wm-git-text"
                class:wm-git-dirty={gitCell.status === "ready" && gitCell.summary.isDirty}
                class:wm-git-clean={gitCell.status === "ready" && !gitCell.summary.isDirty}
                title={gitCellTitle(gitCell)}
              >
                {gitCellDisplayText(gitCell)}
              </span>
            </td>
            {/if}
            <td class="wm-action-col">
              <div class="wm-row-actions">
                {#if showGitColumn}
                  <button
                    type="button"
                    class="btn btn-secondary btn-compact"
                    disabled={!workspace.contextId}
                    title="Version Control"
                    onclick={(event) => {
                      event.stopPropagation();
                      if (workspace.contextId) onOpenVersionControl(workspace.contextId);
                    }}
                  >
                    Version Control
                  </button>
                {/if}
                <button
                  type="button"
                  class="btn btn-secondary btn-compact"
                  disabled={!workspace.contextId}
                  title="Workspace settings"
                  onclick={(event) => {
                    event.stopPropagation();
                    if (workspace.contextId) onOpenWorkspaceSettings(workspace.contextId);
                  }}
                >
                  ⚙ Settings
                </button>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .workspace-manager-view {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-10) var(--space-12) var(--space-12);
    background: var(--color-surface-1);
  }

  .workspace-manager-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-6);
    margin-bottom: var(--space-8);
  }

  .workspace-manager-heading h2 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .workspace-manager-subtitle {
    margin: var(--space-1) 0 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .workspace-manager-actions {
    display: flex;
    gap: var(--space-3);
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /*
   * M2-2 — workspace-manager empty uses the shared EmptyState primitive. The
   * class is forwarded to EmptyState's root, so these overrides target it via
   * :global to escape Svelte's scoped-CSS boundary. The centered variant
   * fills the pane; here we keep the content left-aligned and reset EmptyState's
   * centered padding so it matches the view's own vertical rhythm.
   */
  :global(.workspace-manager-empty) {
    align-items: flex-start;
    text-align: left;
    padding: var(--space-12) 0;
    max-width: none;
    margin: 0;
  }

  :global(.workspace-manager-empty .workspace-manager-actions) {
    margin-top: var(--space-2);
  }

  .workspace-manager-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  .workspace-manager-table th {
    text-align: left;
    padding: var(--space-2) var(--space-4);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .wm-row {
    cursor: pointer;
    transition: background-color var(--motion-fast) var(--easing-standard);
  }

  .wm-row:hover {
    background: var(--color-hover);
  }

  .wm-row:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }

  .wm-row-active {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }

  .wm-row-hidden {
    opacity: 0.7;
  }

  .wm-row td {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
    vertical-align: middle;
  }

  .wm-name {
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
  }

  .wm-path {
    color: var(--color-text-secondary);
  }

  .wm-path-text {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wm-git {
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .wm-git-text {
    display: inline-block;
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
  }

  .wm-git-dirty {
    color: var(--color-text);
  }

  .wm-git-clean {
    color: var(--color-text-secondary);
  }

  .wm-hidden-hint {
    margin-left: var(--space-2);
    font-size: 0.75rem;
    font-style: italic;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .wm-action-col {
    text-align: right;
    white-space: nowrap;
  }

  .wm-row-actions {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
