<script lang="ts">
  import DialogShell from "./DialogShell.svelte";
  import type { PromptAnchor } from "../services/promptAnchor";
  import { tick } from "svelte";
  import {
    registerLocalChangesStashApplyPromptRunner,
    type LocalChangesStashApplyChoice,
    type LocalChangesStashApplyPromptRequest,
  } from "../services/localChangesStashApplyPrompt";

  let open = $state(false);
  let stashRef = $state("");
  let submitting = $state(false);
  let anchor = $state<PromptAnchor | null>(null);
  let primaryButtonEl = $state<HTMLButtonElement | null>(null);

  let resolvePrompt: ((value: LocalChangesStashApplyChoice | null) => void) | null = null;

  async function showPrompt(
    request: LocalChangesStashApplyPromptRequest,
  ): Promise<LocalChangesStashApplyChoice | null> {
    if (resolvePrompt) {
      resolvePrompt(null);
    }
    return new Promise((resolve) => {
      stashRef = request.stashRef;
      submitting = false;
      anchor = request.anchor ?? null;
      resolvePrompt = resolve;
      open = true;
      void tick().then(() => {
        primaryButtonEl?.focus();
      });
    });
  }

  function finish(result: LocalChangesStashApplyChoice | null): void {
    const resolve = resolvePrompt;
    resolvePrompt = null;
    open = false;
    resolve?.(result);
  }

  function choose(choice: LocalChangesStashApplyChoice): void {
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

  $effect(() => {
    registerLocalChangesStashApplyPromptRunner(showPrompt);
    return () => registerLocalChangesStashApplyPromptRunner(null);
  });
</script>

<DialogShell
  {open}
  title="Local changes detected"
  {anchor}
  width={anchor ? 320 : 460}
  onDismiss={cancel}
  panelClass="local-changes-stash-apply-prompt"
>
  <p class="local-changes-stash-apply-prompt-body">
    The working tree has uncommitted changes. How should applying
    <strong>{stashRef}</strong> proceed?
  </p>
  {#snippet actions()}
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
      class="toolbar-button local-changes-stash-apply-prompt-primary"
      disabled={submitting}
      onclick={() => choose({ type: "stash-and-continue" })}
    >
      Stash and continue
    </button>
  {/snippet}
</DialogShell>

<style>
  .local-changes-stash-apply-prompt-body {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text-primary);
    word-break: break-word;
  }

  .local-changes-stash-apply-prompt-primary {
    font-weight: 600;
  }
</style>
