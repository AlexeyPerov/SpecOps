<script lang="ts">
  import { untrack } from 'svelte';
  import { appState } from '../state/appState';
  import { getProjectCatalog, loadProjectCatalog, subscribeProjectCatalog, catalogProjectForRoot, projectIdentity } from '../services/workspaceCatalog';
  import { readLiveWorkspaceWindowOwners, type WorkspaceWindowOwners } from '../services/workspaceWindowPlacement';
  import { addWorkspaceToWindow } from '../services/addWorkspaceToWindow';
  import { rankWorkspaceProjects } from '../services/workspaceSearch';
  import SearchablePickerShell from './SearchablePickerShell.svelte';
  import SearchablePickerOption from './SearchablePickerOption.svelte';

  let { open = false, onClose, currentWindowId = 'main' }: { open?: boolean; onClose: () => void; currentWindowId?: string } = $props();
  let catalog = $state.raw(getProjectCatalog());
  let owners = $state.raw<WorkspaceWindowOwners>({});
  let query = $state('');
  let activeIndex = $state(0);
  let error = $state('');
  let busy = $state(false);
  const openByRoot = $derived(new Map($appState.contexts.workspaces.map(entry => [projectIdentity(entry.rootPath), entry])));
  const projects = $derived.by(() => {
    const entries = { ...catalog.projects };
    for (const workspace of $appState.contexts.workspaces) {
      const id = projectIdentity(workspace.rootPath);
      if (!entries[id]) entries[id] = catalogProjectForRoot(workspace.rootPath);
    }
    return rankWorkspaceProjects(Object.values(entries), query);
  });
  $effect(() => untrack(() => subscribeProjectCatalog(next => { catalog = next; })));
  $effect(() => {
    if (!open) return;
    query = ''; activeIndex = 0; error = '';
    let disposed = false;
    void loadProjectCatalog().catch(reason => { if (!disposed) error = String(reason); });
    void readLiveWorkspaceWindowOwners().then(next => { if (!disposed) owners = next; }).catch(reason => { if (!disposed) error = String(reason); });
    return () => { disposed = true; };
  });
  $effect(() => { if (activeIndex >= projects.length) activeIndex = Math.max(0, projects.length - 1); });
  function openingState(id: string): string {
    if (openByRoot.has(id)) return 'This window';
    if (owners[id] && owners[id] !== currentWindowId) return 'Another window';
    return 'Closed';
  }
  async function select(index: number): Promise<void> {
    const project = projects[index];
    if (!project || busy) return;
    busy = true; error = '';
    try {
      // The existing opening flow validates availability and focuses an owner.
      await addWorkspaceToWindow(project.rootPath);
      onClose();
    } catch (reason) { error = String(reason); }
    finally { busy = false; }
  }
</script>

<SearchablePickerShell {open} label="Switch Workspace" bind:query bind:activeIndex optionCount={projects.length}
  optionIdPrefix="workspace-switcher-option" listId="workspace-switcher-options" placeholder="Search project name or path…"
  {onClose} onSelect={(index) => void select(index)} onQueryInput={() => { activeIndex = 0; error = ''; }}>
  {#each projects as project, index (project.id)}
    <SearchablePickerOption {index} active={index === activeIndex} idPrefix="workspace-switcher-option" disabled={busy}>
      <div class="workspace-option">
        <strong>{project.name}</strong>
        <span>{project.folderId ? catalog.folders[project.folderId]?.name ?? 'Without folder' : 'Without folder'} · {openingState(project.id)}{project.hiddenFromRail ? ' · Hidden' : ''}</span>
        <small title={project.rootPath}>{project.rootPath}</small>
        {#if project.openError}<small>Unavailable: {project.openError}</small>{/if}
      </div>
    </SearchablePickerOption>
  {/each}
  {#snippet footer()}
    {#if error}<p role="alert">{error}</p>{:else}<span role="status">{busy ? 'Opening workspace…' : projects.length ? `${projects.length} projects` : query.trim() ? 'No matching projects.' : 'No projects registered.'}</span>{/if}
  {/snippet}
</SearchablePickerShell>

<style>
  .workspace-option { display: grid; min-width: 0; gap: 2px; }
  .workspace-option span, .workspace-option small { color: var(--color-text-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { margin: 0; }
</style>
