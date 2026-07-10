<script lang="ts">
  import { tick } from "svelte";
  import DialogShell from "./DialogShell.svelte";
  import {
    registerConfirmRunner,
    type ConfirmRequest,
  } from "../services/confirmDialogUi";

  /**
   * M3 (R4) — self-registering host for the promise-based confirm API.
   * Mirrors the TagDeletePrompt / EntryNamePrompt pattern: a `$effect`
   * registers `showConfirm` as the confirm runner on mount and unregisters
   * on cleanup. Single-flight is handled in `showConfirm` by resolving any
   * pending request with `false` before showing the new one.
   */

  let open = $state(false);
  let title = $state("Confirm");
  let message = $state("");
  let confirmLabel = $state("Confirm");
  let cancelLabel = $state("Cancel");
  let danger = $state(false);
  let confirmButtonEl = $state<HTMLButtonElement | null>(null);

  let resolvePrompt: ((value: boolean) => void) | null = null;

  async function showConfirm(request: ConfirmRequest): Promise<boolean> {
    // Single-flight: a previous confirm still pending is cancelled so the
    // new one can take over the dialog (two never overlap).
    if (resolvePrompt) {
      resolvePrompt(false);
    }
    return new Promise((resolve) => {
      title = request.title ?? "Confirm";
      message = request.message;
      confirmLabel = request.confirmLabel ?? "Confirm";
      cancelLabel = request.cancelLabel ?? "Cancel";
      danger = Boolean(request.danger);
      resolvePrompt = resolve;
      open = true;
      void tick().then(() => {
        confirmButtonEl?.focus();
      });
    });
  }

  function finish(result: boolean): void {
    const resolve = resolvePrompt;
    resolvePrompt = null;
    open = false;
    resolve?.(result);
  }

  function confirm(): void {
    finish(true);
  }

  function cancel(): void {
    finish(false);
  }

  $effect(() => {
    registerConfirmRunner(showConfirm);
    return () => registerConfirmRunner(null);
  });
</script>

<DialogShell {open} {title} width={420} onDismiss={cancel}>
  <p class="confirm-dialog-message">{message}</p>
  {#snippet actions()}
    <button type="button" class="btn btn-secondary" onclick={cancel}>
      {cancelLabel}
    </button>
    <button
      bind:this={confirmButtonEl}
      type="button"
      class={danger ? "btn btn-danger" : "btn btn-primary"}
      onclick={confirm}
    >
      {confirmLabel}
    </button>
  {/snippet}
</DialogShell>

<style>
  .confirm-dialog-message {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text-primary);
    word-break: break-word;
  }
</style>
