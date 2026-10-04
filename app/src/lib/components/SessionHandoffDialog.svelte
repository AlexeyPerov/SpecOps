<script lang="ts">
  import { onMount } from 'svelte';
  import ConnectionProfilePanel from './ConnectionProfilePanel.svelte';
  import SessionCatalogPicker from './SessionCatalogPicker.svelte';
  import { loadSessionCatalogs, EMPTY_SESSION_CATALOG, type SessionCatalogSnapshot } from '../services/agentHostRuntime';
  import { collectHandoffDraft, confirmHandoff, openKnownHandoffTarget } from '../services/handoffController';
  import { readHandoffJournal } from '../services/handoffPersistence';
  import { handoffFirstPrompt, type HandoffDraft, type HandoffAttempt, type HandoffTarget } from '../services/sessionHandoff';
  import type { AgentRuntimeId } from '../session';
  let { sourceSessionId, workspaceRootPath, onClose }: { sourceSessionId: string; workspaceRootPath: string; onClose: () => void } = $props();
  let draft = $state<HandoffDraft | null>(null);
  let target = $state<HandoffTarget>({ runtimeId: 'opencode', modelId: '' });
  let targetSessionId = $state('');
  let catalog = $state<SessionCatalogSnapshot>(EMPTY_SESSION_CATALOG);
  let busy = $state(false);
  let error = $state('');
  let excerptPaths = $state('');
  let attempts = $state<HandoffAttempt[]>([]);
  let preview = $state('');
  let previewError = $state('');
  let approval = $state<HandoffAttempt | null>(null);
  let epoch = 0;
  async function refreshCatalog() {
    if (approval) return;
    const current = ++epoch; const selected = { ...target };
    catalog = { ...EMPTY_SESSION_CATALOG, status: 'loading' };
    const next = await loadSessionCatalogs(selected.runtimeId, selected.connectionProfileId);
    if (current !== epoch || approval) return;
    catalog = next;
    target = { ...target, modelId: next.models.some(m => m.id === selected.modelId) ? selected.modelId : next.models[0]?.id ?? '', modeId: next.modes.some(m => m.id === selected.modeId) ? selected.modeId : next.modes[0]?.id };
  }
  $effect(() => {
    if (approval) { preview = approval.approvedPrompt; target = structuredClone($state.snapshot(approval.target)); targetSessionId = approval.targetSessionId; previewError = ''; return; }
    if (!draft || !targetSessionId) return;
    try { preview = handoffFirstPrompt(draft, target, targetSessionId); previewError = ''; }
    catch (failure) { preview = ''; previewError = failure instanceof Error ? failure.message : 'Prompt unavailable'; }
  });
  async function loadEvidence() {
    busy = true; error = '';
    try { draft = await collectHandoffDraft(workspaceRootPath, sourceSessionId, excerptPaths.split('\n').map(p => p.trim()).filter(Boolean)); }
    catch (failure) { error = failure instanceof Error ? failure.message : 'Context unavailable'; }
    finally { busy = false; }
  }
  async function refreshAttempts() {
    attempts = (await readHandoffJournal(workspaceRootPath)).attempts.filter(a => a.sourceSessionId === sourceSessionId);
  }
  onMount(() => {
    targetSessionId = `session-${crypto.randomUUID()}`;
    void loadEvidence();
    void refreshCatalog();
    void refreshAttempts().catch(failure => { error = failure instanceof Error ? failure.message : 'Handoff storage unavailable'; });
  });
  async function confirm() {
    if ((!draft && !approval) || !preview || busy) return;
    busy = true; error = '';
    const attempt: HandoffAttempt = approval ?? { version: 1, id: `handoff-${crypto.randomUUID()}`, sourceSessionId, targetSessionId, workspaceRootPath, target: structuredClone($state.snapshot(target)), approvedPrompt: preview, approvedAt: new Date().toISOString(), stage: 'approved' };
    approval = attempt;
    try {
      const result = await confirmHandoff(attempt);
      if (result.outcome === 'completed') onClose();
      else error = 'The first prompt may have been accepted. Inspect the known target; continue with a new message. This attempt will not resubmit it.';
    } catch (failure) { error = failure instanceof Error ? failure.message : 'Handoff interrupted. Inspect the saved attempt before continuing.'; }
    finally { busy = false; await refreshAttempts().catch(() => {}); }
  }
</script>

<dialog open aria-label="Review session handoff">
  <h2>Review handoff</h2>
  <p>Create a fresh target session from the exact prompt below. Source native history stays with its account. Context is bounded and excludes raw tool output, reasoning, private files and common secret shapes by default. Durable confirmation is available on verified Unix storage; other platforms block native creation until a safe writer is supported. Review the content before sharing it with the target account.</p>
  <ConnectionProfilePanel runtimeId={target.runtimeId} connectionProfileId={target.connectionProfileId} bound={busy || approval !== null} onSelect={(runtimeId: AgentRuntimeId, connectionProfileId?: string) => { target = { runtimeId, connectionProfileId, modelId: '' }; void refreshCatalog(); }} onRefresh={() => void refreshCatalog()} />
  <SessionCatalogPicker runtimeId={target.runtimeId} runtimeLabel={target.runtimeId} {catalog} activeModelId={target.modelId} activeModeId={target.modeId ?? ''} runtimeMetadata={target.runtimeMetadata} disabled={busy || approval !== null} onSelectModel={modelId => { target = { ...target, modelId, runtimeMetadata: {} }; }} onSelectMode={modeId => { target = { ...target, modeId }; }} onSettingsChange={runtimeMetadata => { target = { ...target, runtimeMetadata }; }} />
  <p>Target profile/model/policy are fixed at native creation. Missing authentication, unavailable native turns and unsupported settings block confirmation. Codex requires explicit experimental profile opt-in. Cursor is unavailable in this handoff source slice.</p>
  <label>Optional workspace-relative excerpt paths, one per line<textarea bind:value={excerptPaths} disabled={busy || approval !== null} maxlength="8192"></textarea></label>
  <button onclick={() => void loadEvidence()} disabled={busy || approval !== null}>Regenerate evidence (replaces section edits)</button>
  {#if draft && !approval}
    {#each draft.sections as section (section.id)}
      <fieldset disabled={busy || approval !== null}>
        <label><input type="checkbox" bind:checked={section.included} />Include {section.label}</label>
        <p>{section.evidence}</p>
        <textarea aria-label={section.label} bind:value={section.text} maxlength="8192" disabled={!section.included}></textarea>
      </fieldset>
    {/each}
  {/if}
  <label>Exact first prompt<textarea aria-label="Exact first prompt" readonly value={preview}></textarea></label>
  {#if previewError}<p role="alert">{previewError}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <button onclick={() => void confirm()} disabled={busy || !preview || !target.connectionProfileId || !target.modelId || catalog.status !== 'ready' || target.runtimeId === 'cursor' || target.runtimeId === 'fake'}>Confirm and send reviewed prompt</button>
  <button onclick={onClose} disabled={busy}>Close / cancel review</button>
  {#if attempts.length}
    <h3>Saved attempts</h3>
    {#each attempts as attempt (attempt.id)}
      <p>{attempt.target.runtimeId}, profile {attempt.target.connectionProfileId}: {attempt.stage} {attempt.outcome ?? ''}
        {#if attempt.stage === 'created'}<button onclick={() => { approval = structuredClone($state.snapshot(attempt)); }} disabled={busy}>Review unsent prompt for known target</button>{/if}
        {#if attempt.native}<button onclick={() => { void openKnownHandoffTarget(attempt).then(onClose).catch(failure => { error = failure instanceof Error ? failure.message : 'Target unavailable'; }); }} disabled={busy}>Open known target (no resend)</button>
        {:else if attempt.stage === 'create-intent'}<span>Native creation outcome unknown. Inspect target runtime history. No automatic creation retry.</span>
        {:else if attempt.stage === 'approved'}<button onclick={() => { approval = structuredClone($state.snapshot(attempt)); }} disabled={busy}>Review saved approval</button>{/if}
      </p>
    {/each}
  {/if}
</dialog>

<style>
  dialog { position: fixed; inset: 5vh 8vw; z-index: 100; width: auto; max-height: 90vh; overflow: auto; background: var(--color-surface-1); color: var(--color-text-primary); border: 1px solid var(--color-border-subtle); padding: 20px; }
  textarea { display: block; width: 100%; min-height: 70px; font-family: monospace; }
  textarea[readonly] { min-height: 160px; }
  fieldset { margin: 10px 0; }
</style>
