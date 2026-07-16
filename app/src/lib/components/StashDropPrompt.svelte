<script lang="ts">
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
  let backdropEl = $state<HTMLDivElement | null>(null);
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

  function handleBackdropPointerDown(event: PointerEvent): void {
    if (event.target === backdropEl) {
      cancel();
    }
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  }

  $effect(() => {
    registerStashDropPromptRunner(showPrompt);
    return () => registerStashDropPromptRunner(null);
  });
</script>

{#if open}
  <div
    bind:this={backdropEl}
    class="stash-drop-prompt-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      class="stash-drop-prompt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stash-drop-prompt-title"
      tabindex="-1"
      onkeydown={handleDialogKeydown}
    >
      <h2 id="stash-drop-prompt-title" class="stash-drop-prompt-title">Drop stash</h2>
      <p class="stash-drop-prompt-warning">
        Permanently delete <strong>{stashRef}</strong>?
      </p>
      {#if message}
        <p class="stash-drop-prompt-message">{message}</p>
      {/if}
      <div class="stash-drop-prompt-actions">
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
      </div>
    </div>
  </div>
{/if}

<style>
  .stash-drop-prompt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
  }

  .stash-drop-prompt {
    width: min(420px, calc(100vw - 2 * var(--space-12)));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-10);
    display: grid;
    gap: var(--space-6);
  }

  .stash-drop-prompt-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

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

  .stash-drop-prompt-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-6);
    margin-top: var(--space-4);
  }

  .stash-drop-prompt-danger {
    color: var(--color-danger);
  }
</style>
