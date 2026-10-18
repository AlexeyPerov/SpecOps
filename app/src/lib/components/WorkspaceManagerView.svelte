<script lang="ts">
  import { listen } from "@tauri-apps/api/event";
  import { closeWorkspaceWithConfirm } from "../services/workspaceCloseFlow";
  import { readLiveWorkspaceWindowOwners, WORKSPACE_PLACEMENT_CHANGED, type WorkspaceWindowOwners } from "../services/workspaceWindowPlacement";
  import { managerProjects, sortManagerProjects, applyCatalogBatch, removeClosedCatalogProject, type ManagerProject, type ManagerScope, type ManagerSort, type CatalogBatchAction } from "../services/workspaceCatalogManagement";
  import { onMount } from "svelte";
  import type { ContextId, WorkspaceEntry } from "../domain/contracts";
  import { workspaceGitSummaryPresentation } from "../git/workspaceGitSummaryPresentation";
  import { subscribeWorkspaceGitSummary, refreshWorkspaceGitSummaries, type WorkspaceGitSummarySnapshot } from "../git/workspaceGitSummary";
  import { shouldLoadWorkspaceManagerGitColumn } from "../git/gitIntegrationGating";
  import { emptySet } from "../collections/emptyCollections";
  import { getProjectCatalog, loadProjectCatalog, projectIdentity, subscribeProjectCatalog } from '../services/workspaceCatalog';
  import { addWorkspaceToWindow } from '../services/addWorkspaceToWindow';
  import { workspaceMatchesQuery } from '../services/workspaceSearch';
  import EmptyState from "./EmptyState.svelte";

  /** The catalog owns membership; open entries retain their window context actions. */
  type ManagerRow = ManagerProject;
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
  let owners = $state<WorkspaceWindowOwners>({});
  let scope = $state<ManagerScope>('all');
  let sort = $state<ManagerSort>('manual');
  let selected = $state<Set<string>>(new Set());
  let batchFolder = $state('');
  let batchBusy = $state(false);
  let actionStatus = $state('');
  let actionErrors = $state<string[]>([]);
  let selectionAnchor: string | null = null;
  const allRows = $derived(managerProjects(catalog, workspaces, owners));
  const rows = $derived(sortManagerProjects(allRows.filter(project => workspaceMatchesQuery(project, searchQuery) &&
    (scope === 'all' || (scope === 'hidden' ? isHidden(project) : project.openState === scope))), sort, catalog.folders));
  const selectedIds = $derived([...selected].filter(id => allRows.some(row => row.id === id)));
  async function refreshOwners(): Promise<void> { owners = await readLiveWorkspaceWindowOwners(); }
  onMount(() => {
    let stopped = false;
    let release: (() => void) | undefined;
    const refresh = () => void refreshOwners().catch(error => { catalogError = String(error); });
    const unsubscribe = subscribeProjectCatalog(next => { catalog = next; refresh(); });
    void loadProjectCatalog().catch(error => { catalogError = String(error); });
    refresh();
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      void listen(WORKSPACE_PLACEMENT_CHANGED, refresh).then(unlisten => { if (stopped) unlisten(); else release = unlisten; });
      window.addEventListener('focus', refresh);
    }
    return () => { stopped = true; unsubscribe(); release?.(); window.removeEventListener('focus', refresh); };
  });
  function toggleSelection(id: string): void {
    const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); selected = next; selectionAnchor = id;
  }
  function selectRange(id: string): void {
    const start = rows.findIndex(row => row.id === selectionAnchor); const end = rows.findIndex(row => row.id === id);
    if (start < 0) { toggleSelection(id); return; }
    selected = new Set([...selected, ...rows.slice(Math.min(start, end), Math.max(start, end) + 1).map(row => row.id)]);
  }
  async function batch(action: CatalogBatchAction): Promise<void> {
    if (batchBusy) return;
    batchBusy = true; actionStatus = ''; actionErrors = [];
    try {
      const result = await applyCatalogBatch(selectedIds, action);
      actionStatus = `${result.succeeded.length} project(s) updated; ${result.errors.length} failed.`;
      actionErrors = result.errors.map(error => `${catalog.projects[error.id]?.name ?? error.id}: ${error.message}`);
    } finally { batchBusy = false; }
  }
  async function closeProject(row: ManagerRow): Promise<void> {
    if (!row.contextId || batchBusy) return;
    batchBusy = true; actionErrors = []; actionStatus = '';
    try { await closeWorkspaceWithConfirm(row.contextId, message => { actionStatus = message; }); await refreshOwners(); }
    catch (error) { actionErrors = [String(error)]; }
    finally { batchBusy = false; }
  }
  async function removeProject(row: ManagerRow): Promise<void> {
    if (batchBusy) return;
    batchBusy = true; actionErrors = []; actionStatus = '';
    try { await removeClosedCatalogProject(row.id); selected = new Set([...selected].filter(id => id !== row.id)); actionStatus = 'Project removed from catalog. Files and session history are kept.'; }
    catch (error) { actionErrors = [String(error)]; }
    finally { batchBusy = false; }
  }
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
  function isHidden(workspace: ManagerRow): boolean { return workspace.hiddenFromRail || hiddenRootPaths.has(projectIdentity(workspace.rootPath)); }
  function gitCellForWorkspace(workspace: ManagerRow): WorkspaceGitSummarySnapshot {
    return gitCellsByPath.get(workspace.rootPath) ?? { status: "unknown", refreshing: false, summary: null, checkedAt: null, error: null };
  }
  function gitCellDisplayText(cell: WorkspaceGitSummarySnapshot): string { return workspaceGitSummaryPresentation(cell).text; }
  function gitCellTitle(cell: WorkspaceGitSummarySnapshot): string { return workspaceGitSummaryPresentation(cell).detail; }
  function observeGitRow(node: HTMLElement, input: { path: string; enabled: boolean; active: boolean }) {
    let visible = false;
    let stopped = false;
    const subscription = subscribeWorkspaceGitSummary(input.path, snapshot => {
      gitCellsByPath = new Map(gitCellsByPath).set(input.path, snapshot);
    }, { priority: input.active ? "active" : "visible", enabled: false });
    const update = () => subscription.setDemand({ priority: input.active ? "active" : "visible", enabled: input.enabled && visible });
    const observer = new IntersectionObserver(entries => { if (stopped) return; visible = entries.some(entry => entry.isIntersecting); update(); });
    observer.observe(node);
    return { update(next: typeof input) { input = next; update(); }, destroy() {
      stopped = true; observer.disconnect(); subscription.unsubscribe();
      const next = new Map(gitCellsByPath); next.delete(input.path); gitCellsByPath = next;
    } };
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
  <div class="wm-controls">
    <label>Scope <select aria-label="Project scope" bind:value={scope}>
      <option value="all">All projects</option><option value="here">In this window</option><option value="other">In another window</option><option value="closed">Closed</option><option value="hidden">Hidden</option>
    </select></label>
    <label>Sort <select aria-label="Sort projects" bind:value={sort}><option value="manual">Manual order</option><option value="name">Name</option><option value="recent">Last used</option></select></label>
  </div>
  {#if selectedIds.length}
    <div class="wm-batch" aria-label="Selected project actions">
      <span>{selectedIds.length} selected</span>
      <select aria-label="Assign selected folder" bind:value={batchFolder}><option value="">No folder</option>{#each Object.values(catalog.folders).sort((a,b) => a.order-b.order) as folder (folder.id)}<option value={folder.id}>{folder.name}</option>{/each}</select>
      <button disabled={batchBusy} onclick={() => void batch({ type: 'folder', folderId: batchFolder || null })}>Assign folder</button>
      <button disabled={batchBusy} onclick={() => void batch({ type: 'pin', value: true })}>Pin</button>
      <button disabled={batchBusy} onclick={() => void batch({ type: 'pin', value: false })}>Unpin</button>
      <button disabled={batchBusy} onclick={() => void batch({ type: 'hidden', value: false })}>Show in sidebar</button>
      <button disabled={batchBusy} onclick={() => void batch({ type: 'hidden', value: true })}>Hide from sidebar</button>
      <button onclick={() => { selected = new Set(); }}>Clear selection</button>
    </div>
  {/if}
  {#if actionStatus}<p role="status">{actionStatus}</p>{/if}
  {#each actionErrors as error, index (index)}<p role="alert">{error}</p>{/each}
  {#if allRows.length && rows.length === 0}<p role="status">No matching projects.</p>{/if}
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
          <th scope="col"><input type="checkbox" aria-label="Select filtered projects" checked={rows.length > 0 && rows.every(row => selected.has(row.id))} onchange={(event) => { const next = new Set(selected); for (const row of rows) { if (event.currentTarget.checked) next.add(row.id); else next.delete(row.id); } selected = next; }} /></th>
          <th scope="col">Name</th><th scope="col">Folder</th><th scope="col">State</th>
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
            aria-selected={selected.has(workspace.id)}
            onclick={(event) => {
              if (event.shiftKey) { selectRange(workspace.id); return; }
              if (event.metaKey || event.ctrlKey) { toggleSelection(workspace.id); return; }
              void selectProject(workspace);
            }}
            onkeydown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault(); const current = event.currentTarget as HTMLElement;
                const sibling = event.key === 'ArrowDown' ? current.nextElementSibling : current.previousElementSibling;
                (sibling as HTMLElement | null)?.focus();
              }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); searchQuery = ''; }
              if (event.target !== event.currentTarget) return;
              if (event.key === ' ' && (event.ctrlKey || event.metaKey || event.shiftKey)) { event.preventDefault(); toggleSelection(workspace.id); return; }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void selectProject(workspace);
              }
            }}
            tabindex="0"
          >
            <td><input type="checkbox" aria-label={`Select ${workspace.name}`} checked={selected.has(workspace.id)} onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()} onchange={() => toggleSelection(workspace.id)} /></td>
            <td class="wm-name">{workspace.pinned ? '★ ' : ''}{workspace.name}</td>
            <td>{workspace.folderId ? catalog.folders[workspace.folderId]?.name ?? 'No folder' : 'No folder'}</td>
            <td>{workspace.openState === 'here' ? 'In this window' : workspace.openState === 'other' ? `In another window (${workspace.ownerId})` : 'Closed'}{#if workspace.openError} · Unavailable{/if}</td>
            <td class="wm-path">
              <span class="wm-path-text" title={workspace.rootPath}>{workspace.rootPath}</span>

              {#if workspace.openError}<span class="wm-hidden-hint" title={workspace.openError}>Unavailable: {workspace.openError}</span>{/if}
              {#if hidden}
                <span class="wm-hidden-hint">(hidden from sidebar)</span>
              {/if}
            </td>
            {#if showGitColumn}
            <td class="wm-git">
              <span
                class="wm-git-text"
                class:wm-git-conflict={gitCell.summary?.hasConflicts === true}
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
                {#if workspace.contextId}<button type="button" class="btn btn-secondary btn-compact" disabled={batchBusy} onclick={(event) => { event.stopPropagation(); void closeProject(workspace); }}>Close workspace</button>{/if}
                {#if workspace.openState === 'closed'}<button type="button" class="btn btn-secondary btn-compact" disabled={batchBusy} title="Remove catalog entry; keep files and session history" onclick={(event) => { event.stopPropagation(); void removeProject(workspace); }}>Remove from catalog</button>{/if}
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
  .wm-controls, .wm-batch { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-6); }
  .wm-controls select, .wm-batch select, .wm-batch button { padding: 5px 8px; background: var(--color-surface-1); color: var(--color-text-primary); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); }
  .wm-row[aria-selected="true"] { background: color-mix(in srgb, var(--color-accent) 15%, transparent); }

  .wm-git-text.wm-git-conflict { color: var(--color-danger, #ee7755); font-weight: bold; }
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
