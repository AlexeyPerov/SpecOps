<script lang="ts">
  import SoftwarePanel from './SoftwarePanel.svelte';
  import { componentManager } from '../services/componentManager';
  import { sessionSupportSnapshot } from '../services/sessionSupport';
  import { chatStore } from '../state/chatStore';
  import { onMount } from 'svelte';
  import { ensureAgentHostStarted, getAgentHostClient, loadSessionCatalogs } from '../services/agentHostRuntime';
  import { isNewerProfileSnapshot } from '../session/profiles';
  import type { ConnectionProfileSnapshot } from '../session/profiles';
  import type { AgentRuntimeDescriptor, AgentRuntimeId } from '../session/runtime';
  let { runtimeId, connectionProfileId, bound = false, onSelect, onRefresh = () => {}, onSoftwareAvailability = () => {} }: {
    runtimeId: AgentRuntimeId; connectionProfileId?: string; bound?: boolean;
    onSelect: (runtimeId: AgentRuntimeId, connectionProfileId?: string) => void;
    onRefresh?: () => void;
    onSoftwareAvailability?: (ready: boolean) => void;
  } = $props();
  let runtimes = $state<readonly AgentRuntimeDescriptor[]>([]);
  let profiles = $state<readonly ConnectionProfileSnapshot[]>([]);
  let label = $state('');
  let renameLabel = $state('');
  let providerId = $state('');
  let providerIds = $state<string[]>([]);
  let ownership = $state<'local' | 'external'>('local');
  let endpoint = $state('');
  let refreshEpoch = 0;
  let busy = $state(false);
  let error = $state('');
  let diagnostics = $state('');
  let recovery = $state('');
  let showSoftware = $state(false);
  let softwareReady = $state(false);
  let hostRunning = $state(false);
  const selected = $derived(profiles.find(p => p.id === connectionProfileId));
  function mergeProfiles(incoming: readonly ConnectionProfileSnapshot[]): readonly ConnectionProfileSnapshot[] {
    return incoming.map(profile => { const previous = profiles.find(p => p.id === profile.id); return previous && !isNewerProfileSnapshot(previous, profile) ? previous : profile; });
  }
  async function refresh(probe = false): Promise<void> {
    recovery = ''; softwareReady = false; onSoftwareAvailability(false);
    const selectedRuntime = runtimeId;
    const selectedProfile = connectionProfileId;
    const epoch = ++refreshEpoch;
    const installed = await componentManager.list().catch(() => []);
    if (epoch !== refreshEpoch || selectedRuntime !== runtimeId) return;
    softwareReady = installed.some(component => component.id === selectedRuntime && component.active && component.verified);
    onSoftwareAvailability(softwareReady);
    const client = getAgentHostClient();
    const discovered = (await client.discover()).runtimes;
    if (epoch !== refreshEpoch || selectedRuntime !== runtimeId) return;
    runtimes = discovered;
    hostRunning = (await client.getStatus()).running;
    if (!hostRunning) { recovery = softwareReady ? 'Software is installed. Connect explicitly to review the original account profile; saved session and profile bindings are preserved.' : 'Install the selected component in Software, then connect explicitly. Existing session and profile bindings are preserved.'; return; }
    if (selectedRuntime !== 'codex' && selectedRuntime !== 'opencode' && selectedRuntime !== 'claude' && selectedRuntime !== 'cursor') { profiles = []; return; }
    if (!softwareReady) { recovery = "Install or repair the selected component in Software, then reconnect explicitly."; return; }
    const result = await client.authenticate({ runtimeId: selectedRuntime, workspaceRootPath: '', options: { action: 'list-profiles' } });
    if (epoch !== refreshEpoch || selectedRuntime !== runtimeId) return;
    profiles = mergeProfiles(result.profiles ?? []);
    const hostStatus = await client.getStatus();
    if (epoch !== refreshEpoch || selectedRuntime !== runtimeId || selectedProfile !== connectionProfileId) return;
    const nativeHealth = probe ? await client.health(selectedRuntime, selectedProfile).catch(() => undefined) : undefined;
    if (epoch !== refreshEpoch || selectedRuntime !== runtimeId || selectedProfile !== connectionProfileId) return;
    diagnostics = sessionSupportSnapshot(hostStatus, nativeHealth, profiles.find(profile => profile.id === selectedProfile));
    providerIds = [];
    if (probe && selectedRuntime === 'opencode' && selectedProfile) {
      const catalog = await client.catalogModels(selectedRuntime, undefined, selectedProfile).catch(() => null);
      if (epoch !== refreshEpoch || selectedRuntime !== runtimeId || selectedProfile !== connectionProfileId) return;
      providerIds = [...new Set(catalog?.models.map(model => model.id.split('/')[0]) ?? [])];
      if (!providerIds.includes(providerId)) providerId = providerIds[0] ?? '';
    }
  }
  async function action(action: string): Promise<void> {
    if (!softwareReady) { recovery = 'Install or repair the selected component in Software, then reconnect explicitly.'; return; }
    const selectedRuntime = runtimeId;
    const selectedProfile = connectionProfileId;
    busy = true; error = '';
    try {
      await ensureAgentHostStarted();
      const result = await getAgentHostClient().authenticate({ runtimeId: selectedRuntime, connectionProfileId: selectedProfile, workspaceRootPath: '', options: { action, ...(action === 'rename-profile' ? { label: renameLabel } : {}), ...(action === 'create-profile' ? { label, ...(selectedRuntime === 'opencode' && ownership === 'external' ? { endpoint } : {}) } : {}), ...(selectedRuntime === 'opencode' ? { providerId } : {}) }, ...(action === 'login-api-key' ? { credential: { kind: 'api-key', ref: 'profile-api-key' } as const } : {}) });
      if (selectedRuntime !== runtimeId || selectedProfile !== connectionProfileId) return;
      if (result.profiles) { profiles = mergeProfiles(result.profiles); if (!bound && action === 'create-profile') onSelect(selectedRuntime, result.profile?.id); }
      if (result.profile) { profiles = profiles.map(p => p.id === result.profile!.id && isNewerProfileSnapshot(p, result.profile!) ? result.profile! : p); chatStore.applyConnectionProfileState(result.profile.id, result.profile.generation, ['auth-required', 'missing-profile'].includes(result.profile.state), result.profile.hostGeneration); }
      if (action === 'remove-profile' && !bound) onSelect(selectedRuntime, undefined);
      label = ''; renameLabel = ''; onRefresh();
      await refresh();
    } catch (failure) { error = failure instanceof Error ? failure.message : 'Connection is unavailable. Retry.'; await refresh().catch(() => {}); }
    finally { busy = false; }
  }
  $effect(() => {
    runtimeId; connectionProfileId;
    void refresh().catch(() => { error = 'Runtime discovery failed. Retry connection.'; });
  });
  onMount(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getAgentHostClient().subscribeProfiles(update => {
      if (disposed || update.runtimeId !== runtimeId) return;
      chatStore.applyConnectionProfileState(update.connectionProfileId, update.generation, ['auth-required', 'missing-profile'].includes(update.profile.state), update.hostGeneration);
      profiles = profiles.map(p => p.id === update.connectionProfileId && isNewerProfileSnapshot(p, update.profile) ? update.profile : p);
      if (update.connectionProfileId === connectionProfileId && update.profile.state === 'authenticated') {
        void loadSessionCatalogs(runtimeId, connectionProfileId).then(() => onRefresh());
      }
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  });
</script>

<div class="connection-profiles" aria-label="Session connection">
  {#if runtimeId !== 'fake'}
    <button onclick={() => { showSoftware = !showSoftware; }} aria-expanded={showSoftware}>Manage selected software</button>
    {#if softwareReady && !hostRunning}<button onclick={() => action('list-profiles')} disabled={busy}>Connect selected software</button>{/if}
    {#if showSoftware}{#key runtimeId}<SoftwarePanel {runtimeId} profileId={connectionProfileId} onReady={() => { showSoftware = false; void refresh(); }} />{/key}{/if}
  {/if}
  {#if recovery}<p role="status">{recovery}</p>{/if}
  <label>Runtime
    <select value={runtimeId} disabled={bound || busy} onchange={event => onSelect(event.currentTarget.value as AgentRuntimeId)}>
      {#if !runtimes.length}<option value={runtimeId}>{runtimeId}</option>{/if}
      {#each runtimes as runtime (runtime.id)}<option value={runtime.id}>{runtime.label}</option>{/each}
    </select>
  </label>
  {#if runtimeId === 'codex' || runtimeId === 'opencode' || runtimeId === 'claude' || runtimeId === 'cursor'}
    <label>Account profile
      <select value={connectionProfileId ?? ''} disabled={bound || busy} onchange={event => onSelect(runtimeId, event.currentTarget.value || undefined)}>
        <option value="">Select a profile</option>
        {#if connectionProfileId && !selected}<option value={connectionProfileId}>Missing profile — saved session binding preserved</option>{/if}
        {#each profiles as profile (profile.id)}<option value={profile.id}>{profile.label}</option>{/each}
      </select>
    </label>
    {#if bound && connectionProfileId && !selected}<span role="alert">The saved profile is missing. Session metadata and native history binding are preserved. Restore the selected profile before explicitly resuming this session.</span>{/if}
    {#if !bound}
      <input aria-label="New profile name" placeholder="New account profile" bind:value={label} disabled={busy} maxlength="80" />
      {#if runtimeId === 'opencode'}
        <label>Connection<select bind:value={ownership} disabled={busy}><option value="local">Local native runtime</option><option value="external">Owner-managed endpoint</option></select></label>
        {#if ownership === 'external'}<input aria-label="External runtime endpoint" placeholder="Loopback HTTP or HTTPS origin" bind:value={endpoint} disabled={busy} />{/if}
      {/if}
      <button onclick={() => action('create-profile')} disabled={busy || !softwareReady}>Create profile</button>
    {/if}
    {#if selected}
      <span role="status">{selected.state}{selected.account?.type === 'chatgpt' ? `: ${selected.account.email ?? 'ChatGPT account'} (${selected.account.planType})` : selected.account?.type === 'apiKey' ? ': API key' : ''}</span>
      {#if runtimeId === 'codex'}
      <span>Profile ID: {selected.id}</span>
      <input aria-label="Rename profile" placeholder={selected.label} bind:value={renameLabel} disabled={busy} maxlength="80" />
      <button onclick={() => action('rename-profile')} disabled={busy || !renameLabel.trim()}>Rename profile</button>
      <button onclick={() => action('remove-profile')} disabled={busy}>Remove profile</button>
      <span class="note">Removal signs out this profile and keeps saved sessions and its private native history. Existing sessions keep their original profile ID.</span>
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
      {:else if runtimeId === 'claude' || runtimeId === 'cursor'}
        <button onclick={() => action('login-api-key')} disabled={busy}>Import private API key</button>
        <button onclick={() => action('logout')} disabled={busy}>Remove credential</button>
        <span class="note">Import reads a private 0600 api-key file in this profile’s app data home. {runtimeId === 'cursor' ? 'Local native sessions use profile-bound settings. Browser login and interactive approvals are unavailable. Cloud execution is unavailable.' : 'Subscription login and cloud credential import are unavailable.'}</span>
      {:else}
        <label>Provider<select bind:value={providerId} disabled={busy} aria-label="Native provider">
          <option value="">Select provider</option>
          {#each providerIds as id (id)}<option value={id}>{id}</option>{/each}
        </select></label>
        <button onclick={() => action('login-api-key')} disabled={busy || !providerId || !selected.support.apiKey}>Import private API key</button>
        <button onclick={() => action('logout')} disabled={busy || !providerId || !selected.support.apiKey}>Remove provider credential</button>
        <span class="note">Local import reads the private 0600 api-key file in this profile’s app data home and consumes it after success. External credentials belong to the endpoint owner. Browser/device sign-in is unavailable.</span>
      {/if}
      <button onclick={() => action('read')} disabled={busy}>Verify account</button>
      <button onclick={() => action('restart')} disabled={busy}>Reconnect profile</button>
      {#if selected.usage}
        {#each Object.values(selected.usage.limits) as limit (limit.id)}
          <span>{limit.name ?? limit.id}: {limit.primary ? `${Math.max(0, 100 - limit.primary.usedPercent).toFixed(0)}% remaining` : 'usage unavailable'}{limit.primary?.resetsAt ? `; resets ${new Date(limit.primary.resetsAt * 1000).toLocaleString()}` : ''}</span>
        {/each}
      {/if}
      {#if selected.recovery}<span role="status">{selected.recovery === 'auth-required' ? 'Sign in again, then resume explicitly.' : selected.recovery === 'quota' ? 'Quota blocked. Verify account after recovery, then retry explicitly.' : 'Reconnect or verify account, then retry explicitly.'}</span>{/if}
      {#if selected.message}<span>{selected.message}</span>{/if}
    {/if}
  {/if}
  {#if diagnostics}<button onclick={() => { void navigator.clipboard.writeText(diagnostics).catch(() => { error = 'Could not copy support details.'; }); }}>Copy safe support details</button>{/if}
  <button onclick={() => { void refresh(true).then(() => onRefresh()).catch(() => { error = 'Runtime discovery failed.'; }); }} disabled={busy}>Retry discovery</button>
  {#if error}<span role="alert">{error}</span>{/if}
</div>

<style>
  .connection-profiles { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px; font-size: 11px; }
  label { display: flex; gap: 4px; align-items: center; }
  input, select, button { font: inherit; color: var(--color-text-primary); background: var(--color-surface-1); border: 1px solid var(--color-border-subtle); border-radius: 4px; padding: 3px 6px; }
  .note { color: var(--color-text-secondary); }
</style>
