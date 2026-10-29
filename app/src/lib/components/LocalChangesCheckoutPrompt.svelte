<script lang="ts">
  import DialogShell from "./DialogShell.svelte";
  import type { PromptAnchor } from "../services/promptAnchor";
  import { tick } from "svelte";
  import {
    registerLocalChangesCheckoutPromptRunner,
    type LocalChangesCheckoutChoice,
    type LocalChangesCheckoutPromptRequest,
  } from "../services/localChangesCheckoutPrompt";

  let open = $state(false);
  let branchName = $state("");
  let submitting = $state(false);
  let anchor = $state<PromptAnchor | null>(null);
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
      anchor = request.anchor ?? null;
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

  $effect(() => {
    registerLocalChangesCheckoutPromptRunner(showPrompt);
    return () => registerLocalChangesCheckoutPromptRunner(null);
  });
</script>

<DialogShell
  {open}
  title="Local changes detected"
  {anchor}
  width={anchor ? 320 : 460}
  onDismiss={cancel}
  panelClass="local-changes-checkout-prompt"
>
  <p class="local-changes-checkout-prompt-body">
    The working tree has uncommitted changes. How should checkout to
    <strong>{branchName}</strong> proceed?
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
      class="toolbar-button local-changes-checkout-prompt-primary"
      disabled={submitting}
      onclick={() => choose({ type: "stash-and-continue" })}
    >
      Stash and continue
    </button>
  {/snippet}
</DialogShell>

<style>
  .local-changes-checkout-prompt-body {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text-primary);
    word-break: break-word;
  }

  .local-changes-checkout-prompt-primary {
    font-weight: 600;
  }
</style>
