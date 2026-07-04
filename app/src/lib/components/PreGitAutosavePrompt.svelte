<script lang="ts">
  import { tick } from "svelte";
  import {
    formatPreGitAutosaveFailureLabels,
    registerPreGitAutosavePromptRunner,
    type PreGitAutosavePromptChoice,
    type PreGitAutosavePromptRequest,
  } from "../services/preGitAutosavePrompt";

  let open = $state(false);
  let failureLabels = $state<string[]>([]);
  let submitting = $state(false);
  let backdropEl = $state<HTMLDivElement | null>(null);
  let cancelButtonEl = $state<HTMLButtonElement | null>(null);

  let resolvePrompt: ((value: PreGitAutosavePromptChoice | null) => void) | null = null;

  async function showPrompt(
    request: PreGitAutosavePromptRequest,
  ): Promise<PreGitAutosavePromptChoice | null> {
    if (resolvePrompt) {
      resolvePrompt(null);
    }
    return new Promise((resolve) => {
      failureLabels = formatPreGitAutosaveFailureLabels(request.failures);
      submitting = false;
      resolvePrompt = resolve;
      open = true;
      void tick().then(() => {
        cancelButtonEl?.focus();
      });
    });
  }

  function finish(result: PreGitAutosavePromptChoice | null): void {
    const resolve = resolvePrompt;
    resolvePrompt = null;
    open = false;
    resolve?.(result);
  }

  function choose(choice: PreGitAutosavePromptChoice): void {
    if (submitting) {
      return;
    }
    submitting = true;
    finish(choice);
  }

  function cancel(): void {
    if (submitting) {
      return;
    }
    finish({ type: "cancel" });
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
    registerPreGitAutosavePromptRunner(showPrompt);
    return () => registerPreGitAutosavePromptRunner(null);
  });
</script>

{#if open}
  <div
    bind:this={backdropEl}
    class="pre-git-autosave-prompt-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      class="pre-git-autosave-prompt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pre-git-autosave-prompt-title"
      tabindex="-1"
      onkeydown={handleDialogKeydown}
    >
      <h2 id="pre-git-autosave-prompt-title" class="pre-git-autosave-prompt-title">
        Could not save all files
      </h2>
      <p class="pre-git-autosave-prompt-body">
        Some editor changes were not saved before the git operation:
      </p>
      <ul class="pre-git-autosave-prompt-list">
        {#each failureLabels as label (label)}
          <li>{label}</li>
        {/each}
      </ul>
      <p class="pre-git-autosave-prompt-hint">
        Cancel to keep editing, or continue anyway if you accept proceeding with unsaved buffers.
      </p>
      <div class="pre-git-autosave-prompt-actions">
        <button
          bind:this={cancelButtonEl}
          type="button"
          class="toolbar-button pre-git-autosave-prompt-primary"
          disabled={submitting}
          onclick={cancel}
        >
          Cancel
        </button>
        <button
          type="button"
          class="toolbar-button"
          disabled={submitting}
          onclick={() => choose({ type: "continue-anyway" })}
        >
          Continue anyway
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .pre-git-autosave-prompt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
  }

  .pre-git-autosave-prompt {
    width: min(460px, calc(100vw - 2 * var(--space-12)));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-10);
    display: grid;
    gap: var(--space-6);
  }

  .pre-git-autosave-prompt-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .pre-git-autosave-prompt-body,
  .pre-git-autosave-prompt-hint {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text-primary);
  }

  .pre-git-autosave-prompt-hint {
    color: var(--color-text-secondary);
  }

  .pre-git-autosave-prompt-list {
    margin: 0;
    padding-left: var(--space-8);
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text-primary);
  }

  .pre-git-autosave-prompt-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .pre-git-autosave-prompt-primary {
    font-weight: 600;
  }
</style>
