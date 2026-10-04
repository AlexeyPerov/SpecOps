<script lang="ts">
  import { NATIVE_VIEWS, type NativeView, type NativeAction, type NativeExtensionSnapshot } from '../session/adapter/nativeExtensions';
  import { getAgentHostClient, ensureAgentHostStarted } from '../services/agentHostRuntime';
  import { extensionSession, performNativeAction } from '../services/nativeExtensions';
  let { root, sessionId, disabled = false }: { root: string; sessionId: string; disabled?: boolean } = $props();
  let available = $state(false); let busy = $state(false); let error = $state(''); let snapshot = $state<NativeExtensionSnapshot | null>(null);
  let actions = $state<readonly NativeAction[]>([]);
  let view = $state<NativeView>('checkpoints'); let target = $state(''); let targetKind = $state(''); let url = $state(''); let ticket = 0;
  $effect(() => { const key = `${root}\0${sessionId}`; void key; ticket++; available = false; actions = []; busy = false; snapshot = null; error = ''; url = ''; });
  const labels: Record<string, string> = { checkpoints: 'Message checkpoints', sessions: 'Native sessions', todos: 'Tasks', diffs: 'Session changes', files: 'Workspace file status', languageServices: 'Language and formatting services', commands: 'Native command catalog', ecosystem: 'Tool servers, skills and agents', configuration: 'Effective configuration and providers', fork: 'Fork session', revert: 'Revert to selected checkpoint', restore: 'Restore reverted messages', share: 'Publish conversation link', revokeShare: 'Revoke conversation link', connectToolServer: 'Connect selected tool server', disconnectToolServer: 'Disconnect selected tool server' };
  async function refresh() {
    const epoch = ++ticket; const selectedRoot = root; const selectedId = sessionId; const selectedView = view;
    busy = true; error = ''; available = false; actions = []; target = ''; targetKind = '';
    try {
      await ensureAgentHostStarted();
      const native = extensionSession(selectedRoot, selectedId);
      const found = await getAgentHostClient().discover();
      if (!found.runtimes.find(r => r.id === native.runtimeId)?.capabilities.supported.includes('nativeExtensions')) throw new Error('Native extensions are unavailable for this runtime.');
      const value = await getAgentHostClient().inspectNative({ native, workspaceRootPath: selectedRoot, view: selectedView });
      if (ticket === epoch) { available = true; actions = value.actions; snapshot = value; target = ''; targetKind = '';  }
    } catch { if (ticket === epoch) { error = 'Selected native view is unavailable. Other sessions remain usable.'; snapshot = null; } }
    finally { if (ticket === epoch) busy = false; }
  }
  async function act(action: NativeAction) {
    const epoch = ++ticket; busy = true; error = ''; url = '';
    try {
      const result = await performNativeAction(root, sessionId, action, (action === 'revert' || action === 'connectToolServer' || action === 'disconnectToolServer' || (action === 'fork' && targetKind === 'checkpoint')) ? target || undefined : undefined);
      if (ticket === epoch) { url = result.url ?? ''; snapshot = null; }
    } catch { if (ticket === epoch) { error = 'Native action failed or selection changed. Inspect native state before retrying; no request is replayed.'; available = false; actions = []; target = ''; targetKind = ''; } }
    finally { if (ticket === epoch) busy = false; }
  }
</script>
<details>
  <summary>Native session tools</summary>
  <p>Selected profile and workspace. Configuration and catalogs are read only. Revert changes native history and may restore files; Stop is separate. Sharing publishes the conversation through the native service.</p>
  <select aria-label="Native view" bind:value={view} disabled={busy}>{#each NATIVE_VIEWS as item}<option value={item}>{labels[item]}</option>{/each}</select>
  <button onclick={() => void refresh()} disabled={busy || disabled}>Refresh selected view</button>
  {#if snapshot}<p>{snapshot.scope}</p><ul>{#each snapshot.rows as row}<li><strong>{row.label}</strong> <code>{row.id}</code> {row.detail ?? ''} {#if row.targetKind}<button disabled={busy || disabled} onclick={() => { target = row.id; targetKind = row.targetKind!; }}>Select {row.targetKind === 'checkpoint' ? 'checkpoint' : 'tool server'}</button>{/if}</li>{/each}</ul>{/if}
  {#if available}
    <p>Selected target: {target || 'none; refresh checkpoints or tool server catalog to select'}</p>
    {#each actions as action}<button disabled={busy || disabled || (action === 'revert' && targetKind !== 'checkpoint') || (['connectToolServer', 'disconnectToolServer'].includes(action) && targetKind !== 'toolServer')} onclick={() => void act(action)}>{labels[action]}</button>{/each}
  {/if}
  {#if url}<a href={url} target="_blank" rel="noopener noreferrer">Open shared conversation</a>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</details>
