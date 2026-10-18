<script lang="ts">
  import { untrack } from 'svelte';
  import DialogShell from './DialogShell.svelte';
  import { queryPushSources, pushPlanError, type PushBranch, type PushPlan, type PushResult, type PushSource } from '../git/gitPush';
  import { cancelGitCommand, queryRemoteHeads } from '../git/gitService';
  import { redactRemoteUrl } from '../git/gitPull';
  import { formatGitErrorPrimaryMessage } from '../git/gitErrorUi';
  import type { GitRemote } from '../git/types';
  let { root, remotes, initialRemote, refreshToken = 0, busy, canCancel, error, result, onPush, onClose, onCancel }: {
    root: string; refreshToken?: number; remotes: GitRemote[]; initialRemote: string | null; busy: boolean; canCancel: boolean;
    error: string | null; result: PushResult | null; onPush: (plan: PushPlan) => void; onClose: () => void; onCancel: () => void;
  } = $props();
  let remoteName = $derived(initialRemote ?? remotes[0]?.name ?? '');
  let rows = $state<(PushBranch & { selected: boolean; destination: string; track: boolean })[]>([]);
  let tags = $state<PushSource[]>([]);
  let allTags = $state(false);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let heads = $state<string[]>([]);
  let refresh = $state(0);
  const remote = $derived(remotes.find(item => item.name === remoteName));
  const plan = $derived<PushPlan>({ remote: remoteName, branches: rows.filter(row => row.selected).map(row => ({ ref: row.ref, sha: row.sha, destination: `refs/heads/${row.destination}`, track: row.track })), tags: allTags ? tags.map(tag => ({ ...tag })) : [] });
  const validation = $derived(pushPlanError(plan));
  const valid = $derived(!loading && !loadError && !!remote && !validation && !result);
  // A repository refresh reloads branches only while the dialog is idle with no
  // result: the refresh that follows a push must not re-query the remote (and
  // possibly prompt for credentials again) or reset the rows under the result.
  let appliedRefreshToken = untrack(() => refreshToken);
  $effect(() => {
    const token = refreshToken;
    untrack(() => {
      if (token === appliedRefreshToken || busy || result) return;
      appliedRefreshToken = token;
      refresh += 1;
    });
  });
  $effect(() => {
    const repo = root, name = remoteName;
    const endpoint = remotes.find(item => item.name === name)?.pushUrl ?? name;
    refresh;
    const controller = new AbortController(), commandId = `push-heads-${crypto.randomUUID()}`;
    let pending = !!name;
    loading = true; loadError = null; rows = []; tags = []; heads = []; allTags = false;
    void (async () => {
      try {
        const sources = await queryPushSources(repo);
        const remoteHeads = name ? await queryRemoteHeads(repo, name, { configuredPushUrl: endpoint, commandId, signal: controller.signal, bypassQueue: true, timeoutMs: 30_000 }) : [];
        if (controller.signal.aborted) return;
        heads = remoteHeads;
        rows = sources.branches.map(branch => ({ ...branch, selected: branch.current, destination: branch.upstreamRemote === name && branch.upstreamBranch ? branch.upstreamBranch : branch.name, track: false }));
        tags = sources.tags;
      } catch (error) { if (!controller.signal.aborted) loadError = redactRemoteUrl(formatGitErrorPrimaryMessage(error)); }
      finally { pending = false; if (!controller.signal.aborted) loading = false; }
    })();
    return () => { controller.abort(); if (pending) void cancelGitCommand(commandId).catch(() => {}); };
  });
</script>

<DialogShell open title="Push" width={800} onDismiss={busy ? undefined : onClose} dismissOnBackdrop={!busy}>
  <div class="push-fields">
    <label>Repository<select bind:value={remoteName} disabled={busy || !!result}>
      {#each remotes as item (item.name)}<option value={item.name}>{item.name}</option>{/each}
    </select></label>
    <p class="url">{redactRemoteUrl(remote?.pushUrl ?? remote?.fetchUrl ?? 'No remote configured')}</p>
    {#if loading}<p role="status">Loading branches… Authentication may be requested.</p>{/if}
    {#if loadError}<p role="alert">{loadError}</p>{/if}
    <fieldset disabled={busy || loading || !!result}><legend>Branches to push</legend>
      <div class="branch-actions"><label><input type="checkbox" checked={rows.length > 0 && rows.every(row => row.selected)} onchange={event => { for (const row of rows) row.selected = event.currentTarget.checked; }} /> Select all</label>
      <button type="button" onclick={() => refresh += 1}>Refresh</button></div>
      <div class="table-scroll"><table><thead><tr><th>Push</th><th>Local branch</th><th>Remote branch</th><th>Track</th></tr></thead><tbody>
        {#each rows as row (row.ref)}<tr>
          <td><input type="checkbox" aria-label={`Push ${row.name}`} bind:checked={row.selected} /></td>
          <td><strong>{row.name}</strong>{#if row.current} (current){/if}<small>Upstream: {row.upstream || 'none'}</small></td>
          <td><input aria-label={`Remote branch for ${row.name}`} list="push-destinations" bind:value={row.destination} /></td>
          <td><label><input type="checkbox" aria-label={`Track ${row.name}`} bind:checked={row.track} /> {row.track ? 'Track' : 'Do not change'}</label></td>
        </tr>{/each}
      </tbody></table></div>
      <datalist id="push-destinations">{#each heads as head (head)}<option value={head}></option>{/each}</datalist>
      {#if !loading && !rows.length}<p>No local branches. Select tags explicitly to push tags only.</p>{/if}
      <label><input type="checkbox" bind:checked={allTags} /> Push all tags ({tags.length})</label>
    </fieldset>
    {#if validation && !loading}<p class="hint">{validation}</p>{/if}
    <p class="hint">Only selected branches and explicitly selected tags are sent. Refs may succeed independently. Tracking changes only for successful branches with Track selected.</p>
    {#if error}<p role="alert">{redactRemoteUrl(error)}</p>{/if}
    {#if busy}<p role="status">Push in progress… Cancel operation may leave some refs already sent. Repository state will be refreshed.</p>{/if}
    {#if result}<div role={result.ok ? 'status' : 'alert'}><p>{result.ok ? 'Push completed.' : result.cancelled ? 'Push cancelled. Some refs may have been sent.' : 'Push did not fully complete. Review each ref before retrying.'}</p>
      <p>{redactRemoteUrl(result.message)}</p><ul>{#each result.refs as ref (ref.destination)}<li>{ref.destination}: {ref.status} — {redactRemoteUrl(ref.summary)}{ref.trackingError ? ` ${ref.trackingError}` : ''}</li>{/each}</ul>
    </div>{/if}
  </div>
  {#snippet actions()}
    {#if busy}<button type="button" disabled={!canCancel} onclick={onCancel}>Cancel operation</button>
    {:else}<button type="button" class="btn btn-secondary" onclick={onClose}>{result ? 'Close' : 'Cancel'}</button>{/if}
    <button type="button" class="btn btn-primary" disabled={busy || !valid} onclick={() => { if (valid) onPush({ remote: plan.remote, branches: plan.branches.map(entry => ({...entry})), tags: plan.tags.map(tag=>({...tag})) }); }}>Push</button>
  {/snippet}
</DialogShell>
<style>
  .push-fields { display: grid; gap: var(--space-6); min-width: 0; }
  label { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
  .push-fields > label { display: grid; }
  select { padding: var(--space-3); }
  p { margin: 0; overflow-wrap: anywhere; }
  .url, .hint, small { font-size: var(--font-size-caption); color: var(--color-text-secondary); }
  fieldset { display: grid; gap: var(--space-5); min-width: 0; border: 1px solid var(--color-border-subtle); }
  legend { width: max-content; max-width: 100%; white-space: nowrap; }
  .branch-actions { display: flex; justify-content: space-between; }
  .table-scroll { max-height: 320px; overflow: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: var(--space-3); text-align: left; border-bottom: 1px solid var(--color-border-subtle); }
  td { overflow-wrap: anywhere; max-width: 260px; }
  td input:not([type=checkbox]) { width: 100%; min-width: 130px; }
  small { display: block; }
</style>
