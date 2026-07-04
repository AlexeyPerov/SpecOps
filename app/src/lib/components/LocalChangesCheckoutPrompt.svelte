<script lang="ts">
  import { tick } from "svelte";
  import {
    registerLocalChangesCheckoutPromptRunner,
    type LocalChangesCheckoutChoice,
    type LocalChangesCheckoutPromptRequest,
  } from "../services/localChangesCheckoutPrompt";

  let open = $state(false);
  let branchName = $state("");
  let submitting = $state(false);
  let backdropEl = $state<HTMLDivElement | null>(null);
  let primaryButtonEl = $state<HTMLButtonElement | null>(null);

  let resolvePrompt: ((value: LocalChangesCheckoutChoice | null) => void) | null = null;

  async function showPrompt(
    request: LocalChangesCheckoutPromptRequest,
  ): Promise<LocalChangesCheckoutChoice | null> {
    if (resolvePrompt) {
      resolvePrompt(null);
    }
    return new Promise((resolve) => {
      branchName = request.branchName;
      submitting = false;
      resolvePrompt = resolve;
      open = true;
      void tick().then(() => {
        primaryButtonEl?.focus();
      });
    });
  }

  function finish(result: LocalChangesCheckoutChoice | null): void {
    const resolve = resolvePrompt;
    resolvePrompt = null;
    open = false;
    resolve?.(result);
  }

  function choose(choice: LocalChangesCheckoutChoice): void {
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
    registerLocalChangesCheckoutPromptRunner(showPrompt);
    return () => registerLocalChangesCheckoutPromptRunner(null);
  });
</script>

{#if open}
  <div
    bind:this={backdropEl}
    class="local-changes-checkout-prompt-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      class="local-changes-checkout-prompt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="local-changes-checkout-prompt-title"
      tabindex="-1"
      onkeydown={handleDialogKeydown}
    >
      <h2 id="local-changes-checkout-prompt-title" class="local-changes-checkout-prompt-title">
        Local changes detected
      </h2>
      <p class="local-changes-checkout-prompt-body">
        The working tree has uncommitted changes. How should checkout to
        <strong>{branchName}</strong> proceed?
      </p>
      <div class="local-changes-checkout-prompt-actions">
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
          class="toolbar-button local-changes-checkout-prompt-primary"
          disabled={submitting}
          onclick={() => choose({ type: "stash-and-continue" })}
        >
          Stash and continue
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .local-changes-checkout-prompt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
  }

  .local-changes-checkout-prompt {
    width: min(460px, calc(100vw - 2 * var(--space-12)));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-10);
    display: grid;
    gap: var(--space-6);
  }

  .local-changes-checkout-prompt-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .local-changes-checkout-prompt-body {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text-primary);
    word-break: break-word;
  }

  .local-changes-checkout-prompt-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .local-changes-checkout-prompt-primary {
    font-weight: 600;
  }
</style>
