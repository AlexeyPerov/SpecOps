<script lang="ts">
  import { tick } from "svelte";
  import {
    registerTagDeletePromptRunner,
    type TagDeletePromptRequest,
    type TagDeletePromptResult,
  } from "../services/tagDeletePrompt";

  let open = $state(false);
  let tagName = $state("");
  let remotes = $state<TagDeletePromptRequest["remotes"]>([]);
  let deleteFromRemotes = $state(false);
  let submitting = $state(false);
  let backdropEl = $state<HTMLDivElement | null>(null);
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
    registerTagDeletePromptRunner(showPrompt);
    return () => registerTagDeletePromptRunner(null);
  });
</script>

{#if open}
  <div
    bind:this={backdropEl}
    class="tag-delete-prompt-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      class="tag-delete-prompt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tag-delete-prompt-title"
      tabindex="-1"
      onkeydown={handleDialogKeydown}
    >
      <h2 id="tag-delete-prompt-title" class="tag-delete-prompt-title">Delete tag</h2>
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
      <div class="tag-delete-prompt-actions">
        <button type="button" class="toolbar-button" disabled={submitting} onclick={cancel}>
          Cancel
        </button>
        <button
          bind:this={confirmButtonEl}
          type="button"
          class="toolbar-button tag-delete-prompt-danger"
          disabled={submitting}
          onclick={confirm}
        >
          {submitting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .tag-delete-prompt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
  }

  .tag-delete-prompt {
    width: min(420px, calc(100vw - 2 * var(--space-12)));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-10);
    display: grid;
    gap: var(--space-6);
  }

  .tag-delete-prompt-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

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

  .tag-delete-prompt-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-6);
    margin-top: var(--space-4);
  }

  .tag-delete-prompt-danger {
    color: var(--color-danger, #c0392b);
  }
</style>
