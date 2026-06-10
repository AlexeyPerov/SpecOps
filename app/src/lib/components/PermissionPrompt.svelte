<script lang="ts">
  import {
    registerPermissionPromptRunner,
    type PermissionPromptRequest,
    type PermissionPromptResult,
  } from "../services/permissionPrompt";

  interface Props {
    onNotify?: (message: string) => void;
  }

  let { onNotify = () => {} }: Props = $props();

  let open = $state(false);
  let label = $state("");
  let permissionId = $state("");
  let submitting = $state(false);
  let backdropEl = $state<HTMLDivElement | null>(null);

  let resolvePrompt: ((result: PermissionPromptResult) => void) | null = null;

  async function showPrompt(request: PermissionPromptRequest): Promise<PermissionPromptResult> {
    if (resolvePrompt) {
      resolvePrompt({ reply: "reject" });
    }
    return new Promise((resolve) => {
      label = request.label;
      permissionId = request.permissionId;
      submitting = false;
      resolvePrompt = resolve;
      open = true;
    });
  }

  function finish(result: PermissionPromptResult): void {
    const resolve = resolvePrompt;
    resolvePrompt = null;
    open = false;
    resolve?.(result);
  }

  async function submitReply(reply: PermissionPromptResult["reply"]): Promise<void> {
    if (submitting) return;
    submitting = true;
    finish({ reply });
  }

  function cancel(): void {
    finish({ reply: "reject" });
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
    registerPermissionPromptRunner(showPrompt);
    return () => registerPermissionPromptRunner(null);
  });
</script>

{#if open}
  <div
    bind:this={backdropEl}
    class="permission-prompt-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      class="permission-prompt"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="permission-prompt-title"
      onkeydown={handleDialogKeydown}
      onclick={(event) => event.stopPropagation()}
      onpointerdown={(event) => event.stopPropagation()}
    >
      <h2 id="permission-prompt-title" class="permission-prompt-title">Permission Request</h2>
      <p class="permission-prompt-label">{label}</p>
      <div class="permission-prompt-actions">
        <button
          type="button"
          class="toolbar-button permission-deny"
          disabled={submitting}
          onclick={() => submitReply("reject")}
        >
          Deny
        </button>
        <button
          type="button"
          class="toolbar-button permission-once"
          disabled={submitting}
          onclick={() => submitReply("once")}
        >
          Allow Once
        </button>
        <button
          type="button"
          class="toolbar-button permission-always"
          disabled={submitting}
          onclick={() => submitReply("always")}
        >
          Always Allow
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .permission-prompt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
  }

  .permission-prompt {
    width: min(420px, calc(100vw - 2 * var(--space-12)));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-10);
    display: grid;
    gap: var(--space-8);
  }

  .permission-prompt-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .permission-prompt-label {
    margin: 0;
    font-size: var(--font-size-body);
    color: var(--color-text-primary);
    word-break: break-word;
  }

  .permission-prompt-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-6);
    flex-wrap: wrap;
  }

  .permission-deny {
    margin-right: auto;
  }
</style>
