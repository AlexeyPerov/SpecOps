<script lang="ts">
  import { tick } from "svelte";
  import {
    registerLocalChangesPullPromptRunner,
    type LocalChangesPullChoice,
  } from "../services/localChangesPullPrompt";

  let open = $state(false);
  let submitting = $state(false);
  let backdropEl = $state<HTMLDivElement | null>(null);
  let primaryButtonEl = $state<HTMLButtonElement | null>(null);

  let resolvePrompt: ((value: LocalChangesPullChoice | null) => void) | null = null;

  async function showPrompt(): Promise<LocalChangesPullChoice | null> {
    if (resolvePrompt) {
      resolvePrompt(null);
    }
    return new Promise((resolve) => {
      submitting = false;
      resolvePrompt = resolve;
      open = true;
      void tick().then(() => {
        primaryButtonEl?.focus();
      });
    });
  }

  function finish(result: LocalChangesPullChoice | null): void {
    const resolve = resolvePrompt;
    resolvePrompt = null;
    open = false;
    resolve?.(result);
  }

  function choose(choice: LocalChangesPullChoice): void {
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
    registerLocalChangesPullPromptRunner(showPrompt);
    return () => registerLocalChangesPullPromptRunner(null);
  });
</script>

{#if open}
  <div
    bind:this={backdropEl}
    class="local-changes-pull-prompt-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      class="local-changes-pull-prompt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="local-changes-pull-prompt-title"
      tabindex="-1"
      onkeydown={handleDialogKeydown}
    >
      <h2 id="local-changes-pull-prompt-title" class="local-changes-pull-prompt-title">
        Local changes detected
      </h2>
      <p class="local-changes-pull-prompt-body">
        The working tree has uncommitted changes. Git may refuse to pull when local edits would be
        overwritten. Commit your changes, stash them temporarily, or cancel.
      </p>
      <div class="local-changes-pull-prompt-actions">
        <button type="button" class="toolbar-button" disabled={submitting} onclick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          class="toolbar-button"
          disabled={submitting}
          onclick={() => choose({ type: "block" })}
        >
          Keep changes
        </button>
        <button
          bind:this={primaryButtonEl}
          type="button"
          class="toolbar-button local-changes-pull-prompt-primary"
          disabled={submitting}
          onclick={() => choose({ type: "stash-and-pull" })}
        >
          Stash and pull
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .local-changes-pull-prompt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
  }

  .local-changes-pull-prompt {
    width: min(480px, calc(100vw - 2 * var(--space-12)));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-10);
    display: grid;
    gap: var(--space-6);
  }

  .local-changes-pull-prompt-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .local-changes-pull-prompt-body {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text-primary);
  }

  .local-changes-pull-prompt-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .local-changes-pull-prompt-primary {
    font-weight: 600;
  }
</style>
