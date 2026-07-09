<script lang="ts">
  import { tick } from "svelte";
  import {
    registerTagDeletePromptRunner,
    type TagDeletePromptRequest,
    type TagDeletePromptResult,
  } from "../services/tagDeletePrompt";
  import DialogShell from "./DialogShell.svelte";

  let open = $state(false);
  let tagName = $state("");
  let remotes = $state<TagDeletePromptRequest["remotes"]>([]);
  let deleteFromRemotes = $state(false);
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
      deleteFromRemotes = false;
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
    submitting = true;
    finish({ type: "confirm", deleteFromRemotes });
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
  <label class="tag-delete-prompt-checkbox">
    <input
      type="checkbox"
      bind:checked={deleteFromRemotes}
      disabled={remotes.length === 0 || submitting}
    />
    <span>Also delete from remote(s)</span>
  </label>
  {#if remotes.length === 0}
    <p class="tag-delete-prompt-hint">No remotes configured.</p>
  {:else if deleteFromRemotes}
    <p class="tag-delete-prompt-hint">
      The tag will be deleted on all configured remotes ({remotes.map((r) => r.name).join(", ")}).
    </p>
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
