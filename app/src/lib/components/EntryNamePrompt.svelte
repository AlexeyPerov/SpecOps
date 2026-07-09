<script lang="ts">
  import { tick } from "svelte";
  import { registerEntryNamePromptRunner, type EntryNamePromptRequest } from "../services/entryNamePrompt";
  import DialogShell from "./DialogShell.svelte";

  interface Props {
    onNotify?: (message: string) => void;
  }

  let { onNotify = () => {} }: Props = $props();

  let open = $state(false);
  let title = $state("");
  let value = $state("");
  let confirmLabel = $state("OK");
  let inputEl = $state<HTMLInputElement | null>(null);

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

  function handleInputKeydown(event: KeyboardEvent): void {
    // Enter confirms; Escape is handled by DialogShell (→ cancel).
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

<DialogShell {open} {title} width={360} onDismiss={cancel}>
  <form
    class="entry-name-prompt-form"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    <input
      bind:this={inputEl}
      class="entry-name-prompt-input"
      type="text"
      bind:value
      autocomplete="off"
      spellcheck="false"
      onkeydown={handleInputKeydown}
    />
  </form>
  {#snippet actions()}
    <button type="button" class="btn btn-secondary" onclick={cancel}>Cancel</button>
    <button type="button" class="btn btn-primary" onclick={submit}>{confirmLabel}</button>
  {/snippet}
</DialogShell>

<style>
  .entry-name-prompt-input {
    height: 32px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0 var(--space-8);
    font: inherit;
    width: 100%;
  }

  .entry-name-prompt-input:focus {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }
</style>
