<script lang="ts">
  import DialogShell from "./DialogShell.svelte";
  import type { PromptAnchor } from "../services/promptAnchor";
  import { tick } from "svelte";
  import {
    registerTagPushPromptRunner,
    type TagPushPromptRequest,
    type TagPushPromptResult,
  } from "../services/tagPushPrompt";
  import { resolveDefaultRemote } from "../git/gitParse";

  let open = $state(false);
  let tagName = $state("");
  let remotes = $state<TagPushPromptRequest["remotes"]>([]);
  let selectedRemote = $state("");
  let pushToAll = $state(false);
  let submitting = $state(false);
  let anchor = $state<PromptAnchor | null>(null);
  let confirmButtonEl = $state<HTMLButtonElement | null>(null);

  let resolvePrompt: ((value: TagPushPromptResult | null) => void) | null = null;

  async function showPrompt(request: TagPushPromptRequest): Promise<TagPushPromptResult | null> {
    if (resolvePrompt) {
      resolvePrompt(null);
    }
    return new Promise((resolve) => {
      tagName = request.tagName;
      remotes = request.remotes;
      const defaultRemote = resolveDefaultRemote(request.remotes);
      selectedRemote = defaultRemote?.name ?? request.remotes[0]?.name ?? "";
      pushToAll = false;
      submitting = false;
      anchor = request.anchor ?? null;
      resolvePrompt = resolve;
      open = true;
      void tick().then(() => {
        confirmButtonEl?.focus();
      });
    });
  }

  function finish(result: TagPushPromptResult | null): void {
    const resolve = resolvePrompt;
    resolvePrompt = null;
    open = false;
    resolve?.(result);
  }

  function confirm(): void {
    if (submitting) {
      return;
    }

    const remoteNames = pushToAll
      ? remotes.map((remote) => remote.name)
      : selectedRemote.trim()
        ? [selectedRemote.trim()]
        : [];

    if (remoteNames.length === 0) {
      return;
    }

    submitting = true;
    finish({ type: "confirm", remoteNames });
  }

  function cancel(): void {
    if (submitting) {
      return;
    }
    finish(null);
  }

  $effect(() => {
    registerTagPushPromptRunner(showPrompt);
    return () => registerTagPushPromptRunner(null);
  });
</script>

<DialogShell
  {open}
  title="Push tag"
  {anchor}
  width={anchor ? 320 : 400}
  onDismiss={cancel}
  panelClass="tag-push-prompt"
>
  <p class="tag-push-prompt-label">Tag</p>
  <p class="tag-push-prompt-tag">{tagName}</p>
  <label class="tag-push-prompt-field">
    <span class="tag-push-prompt-field-label">Remote</span>
    <select
      class="tag-push-prompt-select"
      bind:value={selectedRemote}
      disabled={pushToAll || submitting}
    >
      {#each remotes as remote (remote.name)}
        <option value={remote.name}>{remote.name}</option>
      {/each}
    </select>
  </label>
  <label class="tag-push-prompt-checkbox">
    <input type="checkbox" bind:checked={pushToAll} disabled={submitting} />
    <span>Push to all remotes</span>
  </label>
  {#snippet actions()}
    <button type="button" class="toolbar-button" disabled={submitting} onclick={cancel}>
      Cancel
    </button>
    <button
      bind:this={confirmButtonEl}
      type="button"
      class="toolbar-button"
      disabled={submitting}
      onclick={confirm}
    >
      {submitting ? "Pushing…" : "Push"}
    </button>
  {/snippet}
</DialogShell>

<style>
  .tag-push-prompt-label {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .tag-push-prompt-tag {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-primary);
    word-break: break-word;
  }

  .tag-push-prompt-field {
    display: grid;
    gap: var(--space-2);
  }

  .tag-push-prompt-field-label {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .tag-push-prompt-select {
    height: 32px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0 var(--space-4);
    font: inherit;
  }

  .tag-push-prompt-checkbox {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    font-size: 0.875rem;
    color: var(--color-text-primary);
    cursor: pointer;
  }

</style>
