<script lang="ts">
  import { onMount } from 'svelte';
  import { ensureAgentHostStarted, getAgentHostClient, loadSessionCatalogs } from '../services/agentHostRuntime';
  import type { ConnectionProfileSnapshot } from '../session/profiles';
  import type { AgentRuntimeDescriptor, AgentRuntimeId } from '../session/runtime';
  let { runtimeId, connectionProfileId, bound = false, onSelect, onRefresh = () => {} }: {
    runtimeId: AgentRuntimeId; connectionProfileId?: string; bound?: boolean;
    onSelect: (runtimeId: AgentRuntimeId, connectionProfileId?: string) => void;
    onRefresh?: () => void;
  } = $props();
  let runtimes = $state<readonly AgentRuntimeDescriptor[]>([]);
  let profiles = $state<readonly ConnectionProfileSnapshot[]>([]);
  let label = $state('');
  let busy = $state(false);
  let error = $state('');
  const selected = $derived(profiles.find(p => p.id === connectionProfileId));
  async function refresh(): Promise<void> {
    await ensureAgentHostStarted();
    const client = getAgentHostClient();
    runtimes = (await client.discover()).runtimes;
    const result = await client.authenticate({ runtimeId: 'codex', workspaceRootPath: '', options: { action: 'list-profiles' } });
    profiles = result.profiles ?? [];
  }
  async function action(action: string): Promise<void> {
    busy = true; error = '';
    try {
      await ensureAgentHostStarted();
      const result = await getAgentHostClient().authenticate({ runtimeId: 'codex', connectionProfileId, workspaceRootPath: '', options: { action, ...(action === 'create-profile' ? { label } : {}) }, ...(action === 'login-api-key' ? { credential: { kind: 'api-key', ref: 'profile-api-key' } as const } : {}) });
      if (result.profiles) { profiles = result.profiles; if (!bound && action === 'create-profile') onSelect('codex', result.profile?.id); }
      if (result.profile) profiles = profiles.map(p => p.id === result.profile!.id ? result.profile! : p);
      label = ''; onRefresh();
    } catch (failure) { error = failure instanceof Error ? failure.message : 'Connection is unavailable. Retry.'; await refresh().catch(() => {}); }
    finally { busy = false; }
  }
  onMount(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void refresh().catch(() => { error = 'Runtime discovery failed. Retry connection.'; });
    void getAgentHostClient().subscribeProfiles(update => {
      if (disposed) return;
      profiles = profiles.map(p => p.id === update.connectionProfileId && update.generation >= p.generation ? update.profile : p);
      if (update.connectionProfileId === connectionProfileId && update.profile.state === 'authenticated') {
        void loadSessionCatalogs('codex', connectionProfileId).then(() => onRefresh());
      }
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  });
</script>

<div class="connection-profiles" aria-label="Session connection">
  <label>Runtime
    <select value={runtimeId} disabled={bound || busy} onchange={event => onSelect(event.currentTarget.value as AgentRuntimeId)}>
      {#if !runtimes.length}<option value={runtimeId}>{runtimeId}</option>{/if}
      {#each runtimes as runtime}<option value={runtime.id}>{runtime.label}</option>{/each}
    </select>
  </label>
  {#if runtimeId === 'codex'}
    <label>Account profile
      <select value={connectionProfileId ?? ''} disabled={bound || busy} onchange={event => onSelect('codex', event.currentTarget.value || undefined)}>
        <option value="">Select a profile</option>
        {#each profiles as profile}<option value={profile.id}>{profile.label}</option>{/each}
      </select>
    </label>
    {#if !bound}
      <input aria-label="New profile name" placeholder="New account profile" bind:value={label} disabled={busy} maxlength="80" />
      <button onclick={() => action('create-profile')} disabled={busy}>Create profile</button>
    {/if}
    {#if selected}
      <span role="status">{selected.state}{selected.account?.type === 'chatgpt' ? `: ${selected.account.email ?? 'ChatGPT account'} (${selected.account.planType})` : selected.account?.type === 'apiKey' ? ': API key' : ''}</span>
      {#if selected.state === 'login-pending'}
        <span>Complete sign-in in the browser, then verify the account.</span>
        <button onclick={() => action('cancel')} disabled={busy}>Cancel sign-in</button>
      {:else if selected.state !== 'authenticated'}
        <button onclick={() => action('login-browser')} disabled={busy || !selected.support.browser}>Sign in with ChatGPT</button>
        <button onclick={() => action('login-device')} disabled={busy || !selected.support.device}>Device sign-in</button>
        <button onclick={() => action('login-api-key')} disabled={busy}>Import private API key</button>
        <span class="note">API key import reads a private api-key file from this profile’s app data home.</span>
      {:else}
        <button onclick={() => action('logout')} disabled={busy}>Sign out</button>
      {/if}
      <label title="Required for the pinned runtime's legacy history and developer coding slice. Restarts only this profile; pending turns end."><input type="checkbox" checked={selected.experimental ?? false} disabled={busy} onchange={e => action(e.currentTarget.checked ? 'experimental-on' : 'experimental-off')} />Enable experimental protocol (legacy history, plan and questions)</label>
      <button onclick={() => action('read')} disabled={busy}>Verify account</button>
      <button onclick={() => action('restart')} disabled={busy}>Reconnect profile</button>
      {#if selected.message}<span>{selected.message}</span>{/if}
    {/if}
  {/if}
  <button onclick={() => { void refresh().then(() => onRefresh()).catch(() => { error = 'Runtime discovery failed.'; }); }} disabled={busy}>Retry discovery</button>
  {#if error}<span role="alert">{error}</span>{/if}
</div>

<style>
  .connection-profiles { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px; font-size: 11px; }
  label { display: flex; gap: 4px; align-items: center; }
  input, select, button { font: inherit; color: var(--color-text-primary); background: var(--color-surface-1); border: 1px solid var(--color-border-subtle); border-radius: 4px; padding: 3px 6px; }
  .note { color: var(--color-text-secondary); }
</style>
