<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { componentManager, listenComponentJobs, newerComponentJob, type ComponentDiskAccounting, type ComponentRemovalPlan, type ComponentId, type ComponentInventory, type ComponentJob, type ComponentPlan } from '../services/componentManager';
  import { componentBytes, componentFailure, componentLabel } from '../services/componentUi';
  let { runtimeId, profileId, onReady = () => {} }: { runtimeId?: ComponentId; profileId?: string; onReady?: () => void } = $props();
  let inventory = $state<ComponentInventory[]>([]);
  let disk = $state<ComponentDiskAccounting>();
  let groupRemoval = $state<ComponentRemovalPlan | null>(null);
  let jobs = $state<ComponentJob[]>([]);
  let plan = $state<ComponentPlan | null>(null);
  let reviewRequest = $state<ComponentInventory | null>(null);
  let authorizedPlan = $state<ComponentPlan | null>(null);
  let retryJob = $state<ComponentJob | null>(null);
  let removal = $state<ComponentInventory | null>(null);
  let busy = $state(false);
  let cancelling = $state('');
  let loaded = $state(false);
  let error = $state('');
  let target = $state('');
  let diagnosticCopied = $state(false);
  let online = $state(true);
  let confirmButton = $state<HTMLButtonElement>();
  let returnFocus: HTMLElement | null = null;
  let disposed = false;
  let refreshEpoch = 0;
  const visible = $derived(inventory.filter(row => !runtimeId || row.id === runtimeId || row.id === 'node'));
  const running = $derived(jobs.some(job => ['downloading', 'verifying', 'activating'].includes(job.state)));
  function mergeJob(job: ComponentJob) {
    const old = jobs.find(item => item.operationId === job.operationId);
    if (!newerComponentJob(old, job)) return;
    jobs = [...jobs.filter(item => item.operationId !== job.operationId), job].slice(-32);
    if (['installed', 'failed', 'cancelled'].includes(job.state) && cancelling === job.operationId) cancelling = '';
  }
  async function refresh() {
    const epoch = ++refreshEpoch;
    try {
      const snapshot = await componentManager.diagnostics();
      if (disposed || epoch !== refreshEpoch) return;
      disk = snapshot.disk; inventory = snapshot.components; target = `${snapshot.target.os} / ${snapshot.target.arch}`;
      for (const job of snapshot.jobs) mergeJob(job);
      loaded = true;
    } catch (failure) { if (!disposed && epoch === refreshEpoch) { loaded = true; error = componentFailure(failure); } }
  }
  onMount(() => {
    let stop: (() => void) | undefined;
    void listenComponentJobs(job => { if (!disposed) { mergeJob(job); if (job.state === 'installed') void refresh(); } }).then(fn => { if (disposed) fn(); else stop = fn; }).catch(() => {});
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 1500);
    return () => { disposed = true; refreshEpoch++; stop?.(); clearInterval(timer); };
  });
  function dismiss() { plan = null; removal = null; groupRemoval = null; retryJob = null; returnFocus?.focus(); }
  async function review(row: ComponentInventory, update = false) {
    returnFocus = document.activeElement as HTMLElement; busy = true; error = ''; retryJob = null;
    try { const next = await (update ? componentManager.update({ id: row.id, version: row.version }) : componentManager.plan({ id: row.id, version: row.version })); if (!disposed) { plan = next; reviewRequest = row; busy = false; await tick(); confirmButton?.focus(); } }
    catch (failure) { error = componentFailure(failure); }
    finally { busy = false; }
  }
  async function install() {
    const reviewed = plan; if (!reviewed || busy) return;
    if (reviewed.expiresAt * 1000 <= Date.now()) { error = componentFailure('stale'); dismiss(); return; }
    busy = true; error = '';
    try {
      const confirmation = { planId: reviewed.planId, digest: reviewed.digest, confirmed: true };
      const job = retryJob ? await componentManager.retry(retryJob.operationId, retryJob.generation, confirmation) : await componentManager.install(confirmation);
      mergeJob(job); authorizedPlan = reviewed; plan = null; retryJob = null; returnFocus?.focus();
    } catch (failure) { error = componentFailure(failure); }
    finally { busy = false; }
  }
  async function retry(job: ComponentJob) {
    returnFocus = document.activeElement as HTMLElement;
    if (authorizedPlan && authorizedPlan.expiresAt * 1000 > Date.now()) {
      plan = authorizedPlan; retryJob = job; await tick(); confirmButton?.focus();
    } else if (reviewRequest) await review(reviewRequest);
  }
  async function cancel(job: ComponentJob) {
    cancelling = job.operationId; error = '';
    try { mergeJob(await componentManager.cancel(job.operationId, job.generation)); }
    catch (failure) { cancelling = ''; error = componentFailure(failure); }
  }
  async function copyDiagnostics() {
    busy = true; error = ''; diagnosticCopied = false;
    try { const snapshot = await componentManager.diagnostics(); await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2)); diagnosticCopied = true; }
    catch { error = 'Software diagnostics could not be copied. Review the inventory on this panel.'; }
    finally { busy = false; }
  }
  async function checkUpdates() {
    busy = true; error = '';
    try { await componentManager.refreshCatalog(); await refresh(); }
    catch (failure) { error = componentFailure(failure); }
    finally { busy = false; }
  }
  async function reviewGroupRemoval() {
    returnFocus = document.activeElement as HTMLElement; busy = true; error = '';
    try { groupRemoval = await componentManager.removalPlan(); busy = false; await tick(); confirmButton?.focus(); }
    catch (failure) { error = componentFailure(failure); }
    finally { busy = false; }
  }
  async function removeGroup() {
    if (!groupRemoval || busy) return;
    busy = true; error = '';
    try { await componentManager.removeGroup(groupRemoval); groupRemoval = null; await refresh(); returnFocus?.focus(); }
    catch (failure) { error = componentFailure(failure); }
    finally { busy = false; }
  }
  async function mutate(kind: 'select' | 'remove' | 'cache' | 'retained', row?: ComponentInventory) {
    busy = true; error = '';
    try { if (kind === 'cache') await componentManager.cleanCache(); else if (kind === 'retained') await componentManager.cleanRetained(); else if (row) await componentManager[kind]({ id: row.id, version: row.version }); removal = null; await refresh(); returnFocus?.focus(); }
    catch (failure) { error = componentFailure(failure); }
    finally { busy = false; }
  }
</script>

<svelte:window bind:online onfocus={() => void refresh()} onkeydown={event => { if (event.key === 'Escape' && !busy && (plan || removal || groupRemoval)) dismiss(); }} />
<section aria-label="Agent software" aria-busy={busy}>
  <h2>Agent software</h2>
  <p>Software installation is separate from account connections. Opening this panel and choosing a runtime never downloads software.</p>
  {#if runtimeId}<p>Selected runtime: {componentLabel[runtimeId]}. Saved profile: {profileId ?? 'not selected'}. Installation preserves this selection; continue connection or session review explicitly afterwards.</p>{/if}
  <p>{online ? 'Installed components can be used offline, subject to native provider requirements.' : 'You are offline. The editor and installed software remain available; missing software requires connectivity.'}</p>
  {#if target}<p>Supported catalog target: {target}</p>{/if}
  {#if disk}
    <p>Actual allocated disk: active agents {componentBytes(disk.activeBytes)}; retained agents {componentBytes(disk.retainedBytes)}; shared Node {componentBytes(disk.sharedBytes)} counted once; staging {componentBytes(disk.stagingBytes)}; archive cache {componentBytes(disk.cacheBytes)}; other software storage {componentBytes(disk.unrecognizedBytes)} (unrecognized identities and directory metadata, preserved).</p>
    <p>Budgets: active software {componentBytes(disk.activeBudgetBytes)}; archive cache {componentBytes(disk.cacheBudgetBytes)}; {disk.retainedPerComponent} inactive version per component. Leased versions and native account/history data are preserved.</p>
  {/if}
  {#if groupRemoval}
    <div role="dialog" aria-modal="true" aria-label="Review software group removal">
      <h3>Remove reviewed installed software</h3>
      <p>Review exact versions: {groupRemoval.components.map(item => `${componentLabel[item.id]} ${item.version}`).join(', ')}. Only listed versions are removed; unknown software identities remain preserved and can block shared Node removal. Agents are removed before shared Node. Credentials, profiles, workspace sessions and native history are preserved. Running software blocks the whole operation; stop it explicitly before reviewing again.</p>
      <button bind:this={confirmButton} onclick={() => void removeGroup()} disabled={busy || !groupRemoval.components.length}>Remove reviewed software group</button>
      <button onclick={dismiss} disabled={busy}>Keep software</button>
    </div>
  {/if}
  {#if !loaded}<p role="status">Loading software inventory…</p>{/if}
  {#each visible as row (`${row.id}-${row.version}`)}
    <article>
      <h3>{componentLabel[row.id]} · {row.version}</h3>
      <p>{row.state}{row.active ? ' · selected' : row.verified ? ' · retained version' : ''}</p>
      {#if row.target}<p>Platform: {row.target.os} / {row.target.arch}</p>{/if}
      {#if row.availabilityReason}<p>{row.availabilityReason}</p>{/if}
      <p>Download: {row.downloadBytes != null ? componentBytes(row.downloadBytes) : 'unavailable'}. Installed software: {row.installedBytes != null ? componentBytes(row.installedBytes) : 'size unavailable'}. Exact free disk requirement includes dependencies and staging space in the installation review.</p>
      {#if row.dependencies?.length}<p>Shared prerequisites: {row.dependencies.map(item => `${componentLabel[item.id]} ${item.version}`).join(', ')}.</p>{/if}
      {#if row.state === 'unavailable' || row.state === 'unsupported' || row.state === 'incompatible'}
        <p>{componentFailure(row.state === 'incompatible' ? 'target' : row.state)}</p><button disabled>Install unavailable</button>
      {:else if !row.verified}
        <button onclick={() => void review(row)} disabled={busy || running || !online}>Review installation</button>
      {:else}
        {#if !row.active}<button onclick={() => void mutate('select', row)} disabled={busy || running || row.state === 'in-use'}>Select compatible version</button>{/if}
        {#if row.state === 'update-available'}<button onclick={() => void review(row, true)} disabled={busy || running || !online}>Review tested update</button>{/if}
        <button onclick={() => { returnFocus = document.activeElement as HTMLElement; removal = row; void tick().then(() => confirmButton?.focus()); }} disabled={busy || running || row.state === 'in-use'}>Review removal</button>
        {#if row.state === 'in-use'}<p>In use. Stop the owning session explicitly before changing this version.</p>{/if}
      {/if}
    </article>
  {/each}
  {#if loaded && !visible.length}<p>Software inventory is unavailable. Refresh to check the trusted catalog.</p>{/if}
  {#if plan}
    <section aria-label="Review exact installation">
      <h3>Review exact installation</h3>
      <p>Catalog revision {plan.catalogRevision}; review expires {new Date(plan.expiresAt * 1000).toLocaleTimeString()}.</p>
      <ul>{#each plan.components as item (`${item.id}-${item.version}`)}<li>{componentLabel[item.id]} · {item.version}{item.id === 'node' ? ' · shared prerequisite' : ''}</li>{/each}</ul>
      <p>Download: {componentBytes(plan.downloadBytes)}. Required free disk: {componentBytes(plan.requiredDiskBytes)}.</p>
      <p>Install authorizes only these versions and dependencies. It does not connect an account, create a native session or submit a prompt.</p>
      <button bind:this={confirmButton} onclick={() => void install()} disabled={busy || !online}>Install reviewed components</button>
      <button onclick={dismiss} disabled={busy}>Dismiss installation review</button>
    </section>
  {/if}
  {#if removal}
    <section aria-label="Review software removal">
      <h3>Remove {componentLabel[removal.id]} · {removal.version}?</h3>
      <p>Removes owned software only. Workspaces, credentials, account profiles and session/native history are preserved. Shared dependencies and running versions may block removal. Other retained versions stay installed.</p>
      <button bind:this={confirmButton} onclick={() => void mutate('remove', removal!)} disabled={busy}>Remove reviewed software</button><button onclick={dismiss} disabled={busy}>Keep software</button>
    </section>
  {/if}
  {#each jobs as job (job.operationId)}
    <article aria-label="Installation job">
      <p role="status" aria-live="polite">{job.id ? componentLabel[job.id] : 'Reviewed components'}: {job.state === 'activating' ? 'Installing and probing compatibility' : job.state}. {componentBytes(job.completedBytes)} / {job.totalBytes ? componentBytes(job.totalBytes) : 'total unknown'}</p>
      {#if ['downloading', 'verifying', 'activating'].includes(job.state)}
        <progress aria-label="Installation progress" value={job.totalBytes ? job.completedBytes : undefined} max={job.totalBytes || 1}></progress>
        <button onclick={() => void cancel(job)} disabled={cancelling === job.operationId}>{cancelling === job.operationId ? 'Cancellation requested…' : 'Cancel installation'}</button>
      {:else if job.state === 'installed'}
        <p>Software ready. Continue with account connection or session review when you choose; no prompt was replayed.</p>
        {#if runtimeId}<button onclick={onReady}>Continue connection review</button>{/if}
      {:else}
        <p>{componentFailure(job.error ?? 'cancelled')}</p>
        {#if reviewRequest}<button disabled={busy || running || !online} onclick={() => void retry(job)}>Review retry</button>{:else}<p>Select the intended component above to review a fresh plan in this window.</p>{/if}
      {/if}
    </article>
  {/each}
  {#if error}<p role="alert">{error}</p>{/if}
  <button onclick={() => { error = ''; void refresh(); }} disabled={busy}>Refresh software</button>
  <button onclick={() => void mutate('retained')} disabled={busy || running}>Clean excess retained software</button>
  <button onclick={() => void copyDiagnostics()} disabled={busy}>Copy software diagnostics</button>
  {#if diagnosticCopied}<p role="status">Software diagnostics copied. Account credentials, history, archive URLs and private paths are excluded.</p>{/if}
  <button onclick={() => void checkUpdates()} disabled={busy || running || !online}>Check tested updates</button>
  {#if !runtimeId}<button onclick={() => void reviewGroupRemoval()} disabled={busy || running}>Review all software removal</button>{/if}
  <button onclick={() => void mutate('cache')} disabled={busy || running}>Reclaim downloaded cache</button>
  <p>Cache cleanup preserves installed and retained versions. Version changes can be blocked by running sessions or incompatible saved data. Sessions are never stopped automatically.</p>
</section>
<style>
  section { color: var(--color-text-primary); font-size: 12px; }
  article, section section { border: 1px solid var(--color-border-subtle); padding: 10px; margin: 8px 0; border-radius: 4px; }
  h2, h3 { font-size: 14px; margin: 6px 0; }
  button { font: inherit; padding: 4px 8px; margin: 3px; color: var(--color-text-primary); background: var(--color-surface-1); border: 1px solid var(--color-border-subtle); border-radius: 4px; }
  button:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
  button:disabled { opacity: .55; }
</style>
