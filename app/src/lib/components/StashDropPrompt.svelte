<script lang="ts">
  import DialogShell from "./DialogShell.svelte";
  import type { PromptAnchor } from "../services/promptAnchor";
  import { tick } from "svelte";
  import {
    registerStashDropPromptRunner,
    type StashDropPromptRequest,
    type StashDropPromptResult,
  } from "../services/stashDropPrompt";

  let open = $state(false);
  let stashRef = $state("");
  let message = $state("");
  let submitting = $state(false);
  let anchor = $state<PromptAnchor | null>(null);
  let confirmButtonEl = $state<HTMLButtonElement | null>(null);

  let resolvePrompt: ((value: StashDropPromptResult | null) => void) | null = null;

  async function showPrompt(
    request: StashDropPromptRequest,
  ): Promise<StashDropPromptResult | null> {
    if (resolvePrompt) {
      resolvePrompt(null);
    }
    return new Promise((resolve) => {
      stashRef = request.stashRef;
      message = request.message;
      submitting = false;
      anchor = request.anchor ?? null;
      resolvePrompt = resolve;
      open = true;
      void tick().then(() => {
        confirmButtonEl?.focus();
      });
    });
  }

  function finish(result: StashDropPromptResult | null): void {
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
    finish({ type: "confirm" });
  }

  function cancel(): void {
    if (submitting) {
      return;
    }
    finish(null);
  }

  $effect(() => {
    registerStashDropPromptRunner(showPrompt);
    return () => registerStashDropPromptRunner(null);
  });
</script>

<DialogShell
  {open}
  title="Drop stash"
  {anchor}
  width={anchor ? 320 : 420}
  onDismiss={cancel}
  panelClass="stash-drop-prompt"
>
  <p class="stash-drop-prompt-warning">
    Permanently delete <strong>{stashRef}</strong>?
  </p>
  {#if message}
    <p class="stash-drop-prompt-message">{message}</p>
  {/if}
  {#snippet actions()}
    <button type="button" class="toolbar-button" disabled={submitting} onclick={cancel}>
      Cancel
    </button>
    <button
      bind:this={confirmButtonEl}
      type="button"
      class="toolbar-button stash-drop-prompt-danger"
      disabled={submitting}
      onclick={confirm}
    >
      {submitting ? "Dropping…" : "Drop"}
    </button>
  {/snippet}
</DialogShell>

<style>
  .stash-drop-prompt-warning {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text-primary);
    word-break: break-word;
  }

  .stash-drop-prompt-message {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .stash-drop-prompt-danger {
    color: var(--color-danger);
  }
</style>
