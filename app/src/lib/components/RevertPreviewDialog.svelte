<script lang="ts">
  import { tick } from "svelte";
  import { registerRevertPreviewRunner, type RevertPreviewRequest } from "../services/revertPreviewPrompt";

  interface Props {
    onNotify?: (message: string) => void;
  }

  let { onNotify = () => {} }: Props = $props();

  let open = $state(false);
  let request = $state<RevertPreviewRequest | null>(null);
  let backdropEl = $state<HTMLDivElement | null>(null);
  let confirmButtonEl = $state<HTMLButtonElement | null>(null);

  let resolvePrompt: ((value: boolean) => void) | null = null;

  async function showPrompt(req: RevertPreviewRequest): Promise<boolean> {
    if (resolvePrompt) {
      resolvePrompt(false);
    }
    return new Promise((resolve) => {
      request = req;
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
    request = null;
    resolve?.(result);
  }

  function confirm(): void {
    finish(true);
  }

  function cancel(): void {
    finish(false);
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
      confirm();
    }
  }

  $effect(() => {
    registerRevertPreviewRunner(showPrompt);
    return () => registerRevertPreviewRunner(null);
  });

  // Re-format the diff for read-only display: keep only added/removed lines so
  // the preview stays scannable. Hunk headers (@@) are kept as anchors.
  function formatDiff(diff: string | null): string {
    if (!diff) {
      return "(no file changes)";
    }
    return diff;
  }
</script>

{#if open && request}
  <div
    bind:this={backdropEl}
    class="revert-preview-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      class="revert-preview"
      role="dialog"
      aria-modal="true"
      aria-labelledby="revert-preview-title"
      onkeydown={handleDialogKeydown}
      onclick={(event) => event.stopPropagation()}
      onpointerdown={(event) => event.stopPropagation()}
    >
      <h2 id="revert-preview-title" class="revert-preview-title">Undo to here?</h2>
      <p class="revert-preview-body">
        Reverts the session back to <strong>{request.messageLabel}</strong>. Messages and file
        changes after it will be undone. You can restore them afterwards with
        <em>Redo reverted</em>.
      </p>
      <pre class="revert-preview-diff">{formatDiff(request.diff)}</pre>
      <div class="revert-preview-actions">
        <button type="button" class="toolbar-button" onclick={cancel}>Cancel</button>
        <button type="button" class="toolbar-button revert-preview-confirm" bind:this={confirmButtonEl} onclick={confirm}>
          Undo to here
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .revert-preview-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
  }

  .revert-preview {
    width: min(640px, calc(100vw - 2 * var(--space-12)));
    max-height: min(560px, calc(100vh - 2 * var(--space-12)));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-10);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .revert-preview-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .revert-preview-body {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--color-text-secondary);
  }

  .revert-preview-diff {
    flex: 1;
    min-height: 80px;
    max-height: 320px;
    overflow: auto;
    margin: 0;
    padding: var(--space-6);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-family: monospace;
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .revert-preview-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-6);
  }

  .revert-preview-confirm {
    border-color: color-mix(in srgb, #e06c75 55%, var(--color-border-subtle));
    color: #e06c75;
  }
</style>
