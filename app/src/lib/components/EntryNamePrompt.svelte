<script lang="ts">
  import { tick } from "svelte";
  import { registerEntryNamePromptRunner, type EntryNamePromptRequest } from "../services/entryNamePrompt";

  interface Props {
    onNotify?: (message: string) => void;
  }

  let { onNotify = () => {} }: Props = $props();

  let open = $state(false);
  let title = $state("");
  let value = $state("");
  let confirmLabel = $state("OK");
  let inputEl = $state<HTMLInputElement | null>(null);
  let backdropEl = $state<HTMLDivElement | null>(null);

  let resolvePrompt: ((value: string | null) => void) | null = null;

  async function showPrompt(request: EntryNamePromptRequest): Promise<string | null> {
    if (resolvePrompt) {
      resolvePrompt(null);
    }
    return new Promise((resolve) => {
      title = request.title;
      value = request.defaultValue;
      confirmLabel = request.confirmLabel ?? "OK";
      resolvePrompt = resolve;
      open = true;
      void tick().then(() => {
        inputEl?.focus();
        inputEl?.select();
      });
    });
  }

  function finish(result: string | null): void {
    const resolve = resolvePrompt;
    resolvePrompt = null;
    open = false;
    resolve?.(result);
  }

  function submit(): void {
    const trimmed = value.trim();
    if (!trimmed) {
      onNotify("Name cannot be empty.");
      return;
    }
    finish(trimmed);
  }

  function cancel(): void {
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
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      submit();
    }
  }

  $effect(() => {
    registerEntryNamePromptRunner(showPrompt);
    return () => registerEntryNamePromptRunner(null);
  });
</script>

{#if open}
  <div
    bind:this={backdropEl}
    class="entry-name-prompt-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      class="entry-name-prompt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="entry-name-prompt-title"
      tabindex="-1"
      onkeydown={handleDialogKeydown}
    >
      <form
        onsubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 id="entry-name-prompt-title" class="entry-name-prompt-title">{title}</h2>
        <input
          bind:this={inputEl}
          class="entry-name-prompt-input"
          type="text"
          bind:value
          autocomplete="off"
          spellcheck="false"
        />
        <div class="entry-name-prompt-actions">
          <button type="button" class="toolbar-button" onclick={cancel}>Cancel</button>
          <button type="submit" class="toolbar-button">{confirmLabel}</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .entry-name-prompt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
  }

  .entry-name-prompt {
    width: min(360px, calc(100vw - 2 * var(--space-12)));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-10);
  }

  .entry-name-prompt form {
    display: grid;
    gap: var(--space-8);
    margin: 0;
  }

  .entry-name-prompt-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .entry-name-prompt-input {
    height: 32px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0 var(--space-8);
    font: inherit;
  }

  .entry-name-prompt-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-6);
  }
</style>
