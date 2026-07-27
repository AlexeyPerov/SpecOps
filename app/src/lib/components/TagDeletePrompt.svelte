<script lang="ts">
  import { tick } from "svelte";
  import {
    registerTagDeletePromptRunner,
    resolveDefaultDeleteRemote,
    type TagDeletePromptRequest,
    type TagDeletePromptResult,
  } from "../services/tagDeletePrompt";
  import DialogShell from "./DialogShell.svelte";

  let open = $state(false);
  let tagName = $state("");
  let remotes = $state<TagDeletePromptRequest["remotes"]>([]);
  let selectedRemote = $state("");
  let deleteFromAll = $state(false);
  let submitting = $state(false);
  let confirmButtonEl = $state<HTMLButtonElement | null>(null);

  let resolvePrompt: ((value: TagDeletePromptResult | null) => void) | null = null;

  async function showPrompt(
    request: TagDeletePromptRequest,
  ): Promise<TagDeletePromptResult | null> {
    if (resolvePrompt) {
      resolvePrompt(null);
    }
    return new Promise((resolve) => {
      tagName = request.tagName;
      remotes = request.remotes;
      const defaultRemote = resolveDefaultDeleteRemote(request.remotes);
      selectedRemote = defaultRemote?.name ?? "";
      deleteFromAll = false;
      submitting = false;
      resolvePrompt = resolve;
      open = true;
      void tick().then(() => {
        confirmButtonEl?.focus();
      });
    });
  }

  function finish(result: TagDeletePromptResult | null): void {
    const resolve = resolvePrompt;
    resolvePrompt = null;
    open = false;
    resolve?.(result);
  }

  function confirm(): void {
    if (submitting) {
      return;
    }

    // `deleteFromAll` collapses the choice to every configured remote;
    // otherwise the selected remote (if any) is the single target. An empty
    // list means "local only" and is always allowed.
    const remoteNames = deleteFromAll
      ? remotes.map((remote) => remote.name)
      : selectedRemote.trim()
        ? [selectedRemote.trim()]
        : [];

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
    registerTagDeletePromptRunner(showPrompt);
    return () => registerTagDeletePromptRunner(null);
  });
</script>

<DialogShell
  {open}
  title="Delete tag"
  width={420}
  onDismiss={cancel}
  dismissOnBackdrop={!submitting}
>
  <p class="tag-delete-prompt-warning">
    Delete tag <strong>{tagName}</strong> locally?
  </p>
  {#if remotes.length > 0}
    <label class="tag-delete-prompt-field">
      <span class="tag-delete-prompt-field-label">Also delete from remote</span>
      <select
        class="tag-delete-prompt-select"
        bind:value={selectedRemote}
        disabled={deleteFromAll || submitting}
      >
        {#each remotes as remote (remote.name)}
          <option value={remote.name}>{remote.name}</option>
        {/each}
      </select>
    </label>
    <label class="tag-delete-prompt-checkbox">
      <input
        type="checkbox"
        bind:checked={deleteFromAll}
        disabled={submitting}
      />
      <span>Delete from all remotes ({remotes.length})</span>
    </label>
  {:else}
    <p class="tag-delete-prompt-hint">No remotes configured — the tag will be deleted locally only.</p>
  {/if}
  {#snippet actions()}
    <button type="button" class="btn btn-secondary" disabled={submitting} onclick={cancel}>
      Cancel
    </button>
    <button
      bind:this={confirmButtonEl}
      type="button"
      class="btn btn-danger"
      disabled={submitting}
      onclick={confirm}
    >
      {submitting ? "Deleting…" : "Delete"}
    </button>
  {/snippet}
</DialogShell>

<style>
  .tag-delete-prompt-warning {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text-primary);
    word-break: break-word;
  }

  .tag-delete-prompt-field {
    display: grid;
    gap: var(--space-2);
  }

  .tag-delete-prompt-field-label {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .tag-delete-prompt-select {
    height: 32px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0 var(--space-4);
    font: inherit;
  }

  .tag-delete-prompt-checkbox {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    font-size: 0.875rem;
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .tag-delete-prompt-hint {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
</style>
