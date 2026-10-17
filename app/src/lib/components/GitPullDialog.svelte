<script lang="ts">
  import DialogShell from './DialogShell.svelte';
  import { cancelGitCommand, queryRemoteHeads, queryPullSnapshot, queryGitOperationState } from '../git/gitService';
  import { DEFAULT_PULL_OPTIONS, redactRemoteUrl, type PullOptions, type PullSnapshot } from '../git/gitPull';
  import { formatGitErrorPrimaryMessage } from '../git/gitErrorUi';
  import type { GitRemote } from '../git/types';
  let { root, remotes, initialRemote, initialBranch, busy, canCancel, error, onPull, onClose, onCancel }: {
    root: string; remotes: GitRemote[]; initialRemote: string | null; initialBranch: string | null;
    busy: boolean; canCancel: boolean; error: string | null;
    onPull: (target: { remoteName: string; branchName: string }, options: PullOptions, snapshot: PullSnapshot) => void;
    onClose: () => void; onCancel: () => void;
  } = $props();
  let remoteName = $state('');
  let branchName = $state('');
  let heads = $state<string[]>([]);
  let loading = $state(false);
  let headsError = $state<string | null>(null);
  let snapshot = $state<PullSnapshot | null>(null);
  let targetError = $state<string | null>(null);
  let refresh = $state(0);
  let options = $state<PullOptions>({ ...DEFAULT_PULL_OPTIONS });
  const remote = $derived(remotes.find(item => item.name === remoteName));
  const valid = $derived(snapshot !== null && !targetError && !loading && !headsError && heads.includes(branchName) && !!remote);
  $effect(() => {
    const repo = root;
    let disposed = false;
    snapshot = null;
    targetError = null;
    void (async () => {
      try {
        const value = await queryPullSnapshot(repo);
        const state = await queryGitOperationState(repo);
        if (disposed) return;
        snapshot = value;
        if (state.kind !== 'none' || state.conflicts.length) targetError = 'Finish the current Git operation and resolve conflicts before pulling.';
      } catch (error) { if (!disposed) targetError = redactRemoteUrl(formatGitErrorPrimaryMessage(error)); }
    })();
    return () => { disposed = true; };
  });
  $effect(() => {
    remoteName = initialRemote ?? remotes[0]?.name ?? '';
    branchName = initialBranch ?? '';
  });
  $effect(() => {
    const repo = root, name = remoteName;
    refresh;
    const controller = new AbortController();
    const commandId = `remote-heads-${crypto.randomUUID()}`;
    let pending = !!name;
    heads = [];
    headsError = null;
    loading = !!name;
    if (name) {
      void queryRemoteHeads(repo, name, { commandId, signal: controller.signal, bypassQueue: true, timeoutMs: 30_000 }).then(values => {
        if (controller.signal.aborted) return;
        heads = values;
        if (!values.includes(branchName)) branchName = values[0] ?? '';
      }).catch(error => {
        if (!controller.signal.aborted) headsError = redactRemoteUrl(formatGitErrorPrimaryMessage(error));
      }).finally(() => { pending = false; if (!controller.signal.aborted) loading = false; });
    }
    return () => { controller.abort(); if (pending) void cancelGitCommand(commandId).catch(() => {}); };
  });
</script>

<DialogShell open title="Pull" width={600} onDismiss={busy ? undefined : onClose} dismissOnBackdrop={!busy}>
  <div class="pull-fields">
    <label>Repository
      <select bind:value={remoteName} disabled={busy}>
        {#each remotes as item (item.name)}<option value={item.name}>{item.name}</option>{/each}
        <option disabled value="">Custom URL — not supported</option>
      </select>
    </label>
    <p class="url" title={redactRemoteUrl(remote?.fetchUrl ?? '')}>{redactRemoteUrl(remote?.fetchUrl ?? 'No remote configured')}</p>
    <label>Remote branch
      <span class="branch-row"><select bind:value={branchName} disabled={busy || loading || !heads.length}>
        {#each heads as head (head)}<option value={head}>{head}</option>{/each}
      </select><button type="button" disabled={busy || !remoteName} onclick={() => refresh += 1}>Refresh</button></span>
    </label>
    {#if loading}<p role="status">Loading remote branches… Authentication may be requested.</p>
    {:else if headsError}<p role="alert">{headsError}</p>
    {:else if !heads.length}<p role="status">No branches on this remote.</p>{/if}
    <p>Pull into local branch: <strong>{snapshot?.branch ?? 'Checking HEAD…'}</strong></p>
    <fieldset disabled={busy}><legend>Options</legend>
      <label><input type="checkbox" bind:checked={options.commit} disabled={options.strategy === 'rebase'} /> Commit merge immediately</label>
      <label><input type="checkbox" bind:checked={options.log} disabled={options.strategy === 'rebase'} /> Include messages from merged commits</label>
      <label><input type="checkbox" bind:checked={options.noFastForward} disabled={options.strategy === 'rebase'} /> Create a merge commit even when fast-forward is possible</label>
      <label><input type="checkbox" checked={options.strategy === 'rebase'} onchange={event => options.strategy = event.currentTarget.checked ? 'rebase' : 'merge'} /> Rebase instead of merge</label>
    </fieldset>
    <p class="hint">{options.strategy === 'rebase' ? 'Rebase replays local commits and changes local history. Merge options are ignored.' : 'Strategy: merge. Fast-forward does not create a merge commit, even with Commit merge immediately unchecked.'}</p>
    {#if targetError || error}<p role="alert">{targetError ?? redactRemoteUrl(error ?? '')}</p>{/if}
    {#if busy}<p role="status">Pull in progress. Cancellation may leave a Git operation to resolve in Changes.</p>{/if}
  </div>
  {#snippet actions()}
    {#if busy}<button type="button" disabled={!canCancel} onclick={onCancel}>Cancel operation</button>
    {:else}<button type="button" class="btn btn-secondary" onclick={onClose}>Cancel</button>{/if}
    <button type="button" class="btn btn-primary" disabled={busy || !valid} onclick={() => { if (snapshot && valid) onPull({ remoteName, branchName }, { ...options }, { ...snapshot }); }}>Pull</button>
  {/snippet}
</DialogShell>

<style>
  .pull-fields { display: grid; gap: var(--space-6); min-width: 0; }
  label { display: grid; gap: var(--space-3); min-width: 0; }
  select { width: 100%; min-width: 0; padding: var(--space-3); }
  p { margin: 0; overflow-wrap: anywhere; }
  .url, .hint { font-size: var(--font-size-caption); color: var(--color-text-secondary); }
  .branch-row { display: flex; gap: var(--space-4); min-width: 0; }
  fieldset { display: grid; gap: var(--space-4); border: 1px solid var(--color-border-subtle); }
  fieldset label { display: flex; align-items: start; gap: var(--space-4); }
</style>
