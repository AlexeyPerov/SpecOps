<script lang="ts">
  import DialogShell from "./DialogShell.svelte";
  import type { PromptAnchor } from "../services/promptAnchor";
  import { tick } from "svelte";
  import {
    registerLocalChangesPullPromptRunner,
    type LocalChangesPullChoice,
    type LocalChangesPullPromptRequest,
  } from "../services/localChangesPullPrompt";

  let open = $state(false);
  let submitting = $state(false);
  let anchor = $state<PromptAnchor | null>(null);
  let primaryButtonEl = $state<HTMLButtonElement | null>(null);

  let resolvePrompt: ((value: LocalChangesPullChoice | null) => void) | null = null;

  async function showPrompt(
    request: LocalChangesPullPromptRequest,
  ): Promise<LocalChangesPullChoice | null> {
    if (resolvePrompt) {
      resolvePrompt(null);
    }
    return new Promise((resolve) => {
      submitting = false;
      anchor = request.anchor ?? null;
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

  $effect(() => {
    registerLocalChangesPullPromptRunner(showPrompt);
    return () => registerLocalChangesPullPromptRunner(null);
  });
</script>

<DialogShell
  {open}
  title="Local changes detected"
  {anchor}
  width={anchor ? 320 : 480}
  onDismiss={cancel}
  panelClass="local-changes-pull-prompt"
>
  <p class="local-changes-pull-prompt-body">
    The working tree has uncommitted changes. Git may refuse to pull when local edits would be
    overwritten. Commit your changes, stash them temporarily, or cancel.
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
      class="toolbar-button local-changes-pull-prompt-primary"
      disabled={submitting}
      onclick={() => choose({ type: "stash-and-pull" })}
    >
      Stash and pull
    </button>
  {/snippet}
</DialogShell>

<style>
  .local-changes-pull-prompt-body {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text-primary);
  }

  .local-changes-pull-prompt-primary {
    font-weight: 600;
  }
</style>
