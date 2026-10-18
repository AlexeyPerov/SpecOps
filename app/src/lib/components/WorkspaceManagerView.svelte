<script lang="ts">
  import { onMount } from "svelte";
  import type { ContextId, WorkspaceEntry } from "../domain/contracts";
  import { formatGitColumnDisplayText } from "../git/workspaceManagerGitColumn";
  import { subscribeWorkspaceGitSummary, refreshWorkspaceGitSummaries, type WorkspaceGitSummarySnapshot } from "../git/workspaceGitSummary";
  import { shouldLoadWorkspaceManagerGitColumn } from "../git/gitIntegrationGating";
  import { emptySet } from "../collections/emptyCollections";
  import { getProjectCatalog, loadProjectCatalog, projectIdentity, subscribeProjectCatalog } from '../services/workspaceCatalog';
  import { addWorkspaceToWindow } from '../services/addWorkspaceToWindow';
  import { workspaceMatchesQuery } from '../services/workspaceSearch';
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
  let searchQuery = $state('');
  const allRows: ManagerRow[] = $derived.by(() => {
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
  const rows = $derived(allRows.filter(project => workspaceMatchesQuery(project, searchQuery)));
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

  let gitCellsByPath = $state<Map<string, WorkspaceGitSummarySnapshot>>(new Map());
  let gitRefreshBusy = $state(false);
  const showGitColumn = $derived(shouldLoadWorkspaceManagerGitColumn());
  function isHidden(workspace: ManagerRow): boolean { return hiddenRootPaths.has(projectIdentity(workspace.rootPath)); }
  function gitCellForWorkspace(workspace: ManagerRow): WorkspaceGitSummarySnapshot {
    return gitCellsByPath.get(workspace.rootPath) ?? { status: "unknown", refreshing: false, summary: null, checkedAt: null, error: null };
  }
  function gitCellDisplayText(cell: WorkspaceGitSummarySnapshot): string {
    if (cell.summary) return formatGitColumnDisplayText(cell.summary);
    if (cell.status === "loading") return "…";
    return cell.status === "error" ? "Git error" : "—";
  }
  function gitCellTitle(cell: WorkspaceGitSummarySnapshot): string {
    const details = cell.summary ? `${formatGitColumnDisplayText(cell.summary)}. Ahead/behind uses locally known upstream refs; no fetch is performed.` : cell.status === "notGit" ? "Not a Git repository" : "Git status unknown";
    const state = cell.refreshing ? "Checking…" : cell.status === "stale" ? "Stale" : cell.status === "error" ? cell.error : "";
    return [details, state, cell.checkedAt ? `Last checked ${new Date(cell.checkedAt).toLocaleTimeString()}` : ""].filter(Boolean).join(" · ");
  }
  function observeGitRow(node: HTMLElement, input: { path: string; enabled: boolean; active: boolean }) {
    let visible = false;
    const subscription = subscribeWorkspaceGitSummary(input.path, snapshot => {
      gitCellsByPath = new Map(gitCellsByPath).set(input.path, snapshot);
    }, { priority: input.active ? "active" : "visible", enabled: false });
    const update = () => subscription.setDemand({ priority: input.active ? "active" : "visible", enabled: input.enabled && visible });
    const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); update(); });
    observer.observe(node);
    return { update(next: typeof input) { input = next; update(); }, destroy() { observer.disconnect(); subscription.unsubscribe(); } };
  }
  async function handleRefreshGitColumn(): Promise<void> {
    if (gitRefreshBusy || !rows.length) return;
    gitRefreshBusy = true;
    try { await refreshWorkspaceGitSummaries(rows.map(row => row.rootPath)); }
    finally { gitRefreshBusy = false; }
  }
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

  <input class="wm-search" aria-label="Search all workspaces" placeholder="Search name or path…" bind:value={searchQuery}
    onkeydown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); searchQuery = ''; }
      if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); (event.currentTarget as HTMLElement).closest('.workspace-manager-view')?.querySelector<HTMLElement>('.wm-row')?.focus(); }
    }} />
  {#if searchQuery.trim() && rows.length === 0}<p role="status">No matching projects.</p>{/if}
  {#if catalogError}<p role="alert">{catalogError}</p>{/if}
  {#if allRows.length === 0}
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
          <tr use:observeGitRow={{ path: workspace.rootPath, enabled: showGitColumn, active: workspace.contextId === activeContextId }}
            class="wm-row"
            class:wm-row-active={activeContextId === workspace.contextId}
            class:wm-row-hidden={hidden}
            onclick={() => void selectProject(workspace)}
            onkeydown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault(); const current = event.currentTarget as HTMLElement;
                const sibling = event.key === 'ArrowDown' ? current.nextElementSibling : current.previousElementSibling;
                (sibling as HTMLElement | null)?.focus();
              }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); searchQuery = ''; }
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
                class:wm-git-dirty={gitCell.summary?.isDirty === true}
                class:wm-git-clean={gitCell.summary !== null && !gitCell.summary.isDirty}
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
  .wm-search { width: min(480px, 100%); padding: 6px 8px; margin-bottom: var(--space-6); background: var(--color-surface-1); color: var(--color-text-primary); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); }
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
