<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { readGitWorkspaceViewState, saveGitWorkspaceViewState } from '../git/gitWorkspaceViewState';
  import { formatGitErrorPrimaryMessage } from '../git/gitErrorUi';
  import { queryBranches, queryTags, queryStashes } from '../git/gitService';
  import { loadRemotes } from '../git/versionControlRemotesCache';
  import { buildNavigationTree, visibleNavigationRows, findNavigationNode, queryRemoteTrackingRefs, type NavigationNode, type NavigationRow } from '../git/gitNavigationTree';
  let { repoRoot, stateKey, bare = false, refreshToken = 0, selectedId = 'history', onSelect, onAction }: {
    repoRoot: string; stateKey?: string; bare?: boolean; refreshToken?: number; selectedId?: string;
    onSelect: (node: NavigationNode | null) => void;
    onAction: (section: 'branches' | 'tags' | 'stashes', selected: string | null) => void;
  } = $props();
  const ownedStateKey = untrack(() => stateKey);
  const restored = readGitWorkspaceViewState(ownedStateKey)?.navigation;
  let restorePending = true;
  onDestroy(() => saveGitWorkspaceViewState(ownedStateKey, { navigation: { filter, collapsed: [...collapsed], focus: focusId } }));
  let activeRoot = '';
  let nodes = $state<NavigationNode[]>([]);
  let collapsed = $state<string[]>([]);
  let filter = $state('');
  let status = $state('loading');
  let error = $state('');
  let missing = $state(false);
  let focusId = $state('history');
  let menu = $state<NavigationNode | null>(null);
  let tree = $state<HTMLDivElement | null>(null);
  const rows = $derived(visibleNavigationRows(nodes, collapsed, filter));
  const tabStop = $derived(rows.some(row => row.node.id === focusId) ? focusId : rows[0]?.node.id);
  // Repository reads are an effect; derived rows never mutate user expansion.
  $effect(() => {
    const root = repoRoot;
    if (activeRoot !== root) {
      activeRoot = root; nodes = []; collapsed = restorePending ? [...(restored?.collapsed ?? [])] : []; filter = restorePending ? restored?.filter ?? '' : ''; focusId = restorePending ? restored?.focus ?? 'history' : 'history'; restorePending = false; missing = false;
    }
    void refreshToken;
    const controller = new AbortController();
    status = 'loading'; error = ''; menu = null;
    void (async () => {
      try {
        const results = await Promise.all([queryBranches(root, 'versionControl'), queryTags(root), loadRemotes(root), queryRemoteTrackingRefs(root), bare ? Promise.resolve([]) : queryStashes(root)]);
        if (controller.signal.aborted) return;
        nodes = buildNavigationTree(...results);
        if (bare) {
          nodes = nodes.filter(node => node.id !== "stashes");
          const workspace = nodes.find(node => node.id === "workspace");
          if (workspace?.children) workspace.children = workspace.children.filter(node => node.id !== "changes");
        }
        status = 'ready';
        const id = untrack(() => selectedId);
        const selected = findNavigationNode(nodes, id);
        missing = !selected;
        if (missing) onSelect(null);
        else if (selected?.kind === 'stash') onSelect(selected);
      } catch (cause) {
        if (controller.signal.aborted) return;
        status = 'error'; error = formatGitErrorPrimaryMessage(cause);
      }
    })();
    return () => controller.abort();
  });
  function toggle(id: string) { if (filter.trim()) return; collapsed = collapsed.includes(id) ? collapsed.filter(item => item !== id) : [...collapsed, id]; }
  function select(node: NavigationNode) {
    if (status !== 'ready') return;
    focusId = node.id; menu = null;
    if (node.children) toggle(node.id);
    else if (node.id !== 'search') { missing = false; onSelect(node); }
  }
  function focus(id: string | undefined) {
    if (!id) return;
    focusId = id;
    const index = rows.findIndex(row => row.node.id === id);
    tree?.querySelectorAll<HTMLElement>('[role="treeitem"]')[index]?.focus();
  }
  function keydown(event: KeyboardEvent, row: NavigationRow) {
    const index = rows.findIndex(item => item.node.id === row.node.id);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape', 'ContextMenu'].includes(event.key) || (event.shiftKey && event.key === 'F10')) event.preventDefault();
    switch (event.key) {
      case 'ArrowDown': focus(rows[Math.min(rows.length - 1, index + 1)]?.node.id); break;
      case 'ArrowUp': focus(rows[Math.max(0, index - 1)]?.node.id); break;
      case 'Home': focus(rows[0]?.node.id); break;
      case 'End': focus(rows.at(-1)?.node.id); break;
      case 'ArrowRight': if (row.node.children) { if (!row.expanded) toggle(row.node.id); else focus(rows[index + 1]?.node.id); } break;
      case 'ArrowLeft': if (row.node.children && row.expanded) toggle(row.node.id); else focus(row.parentId ?? undefined); break;
      case 'Enter': case ' ': select(row.node); break;
      case 'Escape': menu = null; break;
      case 'ContextMenu': if (status === 'ready') menu = row.node; break;
      case 'F10': if (event.shiftKey && status === 'ready') menu = row.node; break;
    }
  }
  function operations(node: NavigationNode): 'branches' | 'tags' | 'stashes' | null {
    if (node.kind === 'branch' || node.id === 'branches' || node.id.startsWith('branches/group/')) return 'branches';
    if (node.kind === 'tag' || node.id === 'tags' || node.id.startsWith('tags/group/')) return 'tags';
    if (node.kind === 'stash' || node.id === 'stashes') return 'stashes';
    return null;
  }
</script>

<svelte:window onkeydown={event => { if (event.key === "Escape" && menu) { menu = null; focus(focusId); } }} />

<div class="navigation">
  <div class="tree-scroll">
    {#if status === 'loading'}<p role="status">Loading navigation…</p>{/if}
    {#if status === 'error'}<p role="alert">Could not load navigation: {error}</p>{/if}
    {#if missing}<p role="status">The selected reference is no longer available. Select another item.</p>{/if}
    <div role="tree" aria-label="Repository navigation" aria-busy={status === 'loading'} bind:this={tree}>
      {#each rows as row (row.node.id)}
        <button type="button" role="treeitem" aria-level={row.depth} aria-expanded={row.node.children ? row.expanded : undefined}
          aria-selected={selectedId === row.node.id} aria-current={row.node.branch?.isCurrent ? "true" : undefined} aria-disabled={row.node.id === 'search'} tabindex={tabStop === row.node.id ? 0 : -1}
          class:group={!!row.node.children} class:selected={selectedId === row.node.id} style:padding-left={`${(row.depth - 1) * 14 + 8}px`}
          title={[row.node.id, row.node.detail].filter(Boolean).join('\n')}
          onclick={() => select(row.node)} onfocus={() => focusId = row.node.id} onkeydown={event => keydown(event, row)}
          oncontextmenu={event => { event.preventDefault(); if (status !== 'ready') return; focusId = row.node.id; menu = row.node; }}>
          <span class="marker" aria-hidden="true">{row.node.children ? (row.expanded ? '▾' : '▸') : row.node.branch?.isCurrent ? '●' : '·'}</span>
          <span class="label">{row.node.label}</span>
          {#if row.node.children}<span class="count">{row.node.children.length}</span>{/if}
          {#if row.node.branch?.upstreamTrack}<span class="tracking">{row.node.branch.upstreamTrack}</span>{/if}
          {#if row.node.detail?.startsWith('HEAD')}<span class="count">HEAD</span>{/if}
        </button>
        {#if row.node.children && row.expanded && row.node.children.length === 0}<p class="empty" style:padding-left={`${row.depth * 14 + 8}px`}>No {row.node.label.toLowerCase()}</p>{/if}
      {:else}
        {#if status === 'ready'}<p role="status">No matching references</p>{/if}
      {/each}
    </div>
    {#if menu}
      <div class="actions" aria-label="Reference actions">
        <p title={menu.id}>{menu.label}</p>
        {#if operations(menu)}
          <button type="button" onclick={() => { const node = menu!; menu = null; onAction(operations(node)!, node.revision ?? null); }}>{operations(menu) === "branches" ? "Branch actions: Checkout / Create…" : operations(menu) === "tags" ? "Tag actions: Create / Push / Delete…" : "Stash actions: Create / Apply / Drop…"}</button>
        {/if}
        {#if menu.revision}<button type="button" onclick={() => select(menu!)}>View history</button>{/if}
        <button type="button" onclick={() => { menu = null; focus(focusId); }}>Close</button>
      </div>
    {/if}
    <p class="unavailable">Search unavailable — commit search is not implemented.</p>
  </div>
  <input aria-label="Filter repository navigation" placeholder="Filter navigation" bind:value={filter} />
</div>

<style>
  .navigation { position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; font-size: 12px; }
  .tree-scroll { flex: 1; min-height: 0; overflow: auto; }
  button { display: flex; align-items: center; gap: 5px; width: 100%; min-height: 26px; border: 0; background: transparent; color: var(--color-text); text-align: left; font: inherit; cursor: pointer; }
  button:hover { background: var(--color-surface-2); }
  button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
  .group { font-weight: 600; margin-top: 5px; }
  .selected { background: color-mix(in srgb, var(--color-accent) 18%, transparent); }
  [aria-disabled="true"], .count, .empty, .unavailable { color: var(--color-text-muted); }
  .marker { width: 10px; flex-shrink: 0; }
  .label, .actions p { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .label { flex: 1; }
  .tracking { flex-shrink: 0; font-size: 10px; }
  .count { flex-shrink: 0; font-size: 10px; }
  p { margin: 4px 8px; overflow-wrap: anywhere; }
  .empty, .unavailable { font-size: 11px; }
  .unavailable { margin-top: 12px; }
  .actions { position: absolute; bottom: 36px; left: 0; right: 0; z-index: 2; margin: 6px; padding: 6px; background: var(--color-surface-2); border: 1px solid var(--color-border-subtle); }
  input { flex-shrink: 0; width: calc(100% - 12px); margin: 6px; padding: 5px; background: var(--color-surface-1); border: 1px solid var(--color-border-subtle); color: var(--color-text); }
</style>
