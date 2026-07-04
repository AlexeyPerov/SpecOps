<script lang="ts">
  import { tick } from "svelte";
  import {
    registerAskpassPromptRunner,
    type AskpassPromptResult,
  } from "../services/askpassPrompt";
  import { startGitAskpassBridge, stopGitAskpassBridge } from "../git/gitAskpass";
  import type { GitAskpassRequest } from "../git/types";

  let open = $state(false);
  let prompt = $state("");
  let hostHint = $state<string | null>(null);
  let inputKind = $state<GitAskpassRequest["inputKind"]>("password");
  let operation = $state<GitAskpassRequest["operation"]>(null);
  let value = $state("");
  let submitting = $state(false);
  let backdropEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);

  let resolvePrompt: ((result: AskpassPromptResult) => void) | null = null;

  function operationLabel(op: GitAskpassRequest["operation"]): string {
    switch (op) {
      case "fetch":
        return "Fetch";
      case "pull":
        return "Pull";
      case "push":
        return "Push";
      case "tagPush":
        return "Push tag";
      case "tagDelete":
        return "Delete remote tag";
      case "lsRemote":
        return "List remote tags";
      default:
        return "Git";
    }
  }

  function inputLabel(kind: GitAskpassRequest["inputKind"]): string {
    if (kind === "username") {
      return "Username";
    }
    if (kind === "passphrase") {
      return "Passphrase";
    }
    return "Password";
  }

  async function showPrompt(request: GitAskpassRequest): Promise<AskpassPromptResult> {
    if (resolvePrompt) {
      resolvePrompt({ type: "cancel" });
    }
    return new Promise((resolve) => {
      prompt = request.prompt;
      hostHint = request.hostHint;
      inputKind = request.inputKind;
      operation = request.operation;
      value = request.usernameHint ?? "";
      submitting = false;
      resolvePrompt = resolve;
      open = true;
      void tick().then(() => {
        inputEl?.focus();
        if (inputKind !== "username") {
          inputEl?.select();
        }
      });
    });
  }

  function finish(result: AskpassPromptResult): void {
    const resolve = resolvePrompt;
    resolvePrompt = null;
    open = false;
    value = "";
    resolve?.(result);
  }

  function confirm(): void {
    if (submitting) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    submitting = true;
    finish({ type: "submit", value: trimmed });
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
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      confirm();
    }
  }

  $effect(() => {
    registerAskpassPromptRunner(showPrompt);
    void startGitAskpassBridge();
    return () => {
      registerAskpassPromptRunner(null);
      void stopGitAskpassBridge();
    };
  });
</script>

{#if open}
  <div
    bind:this={backdropEl}
    class="askpass-prompt-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      class="askpass-prompt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="askpass-prompt-title"
      tabindex="-1"
      onkeydown={handleDialogKeydown}
    >
      <h2 id="askpass-prompt-title" class="askpass-prompt-title">
        {operation ? `${operationLabel(operation)} credentials` : "Git credentials"}
      </h2>
      <p class="askpass-prompt-body">{prompt}</p>
      {#if hostHint}
        <p class="askpass-prompt-host">{hostHint}</p>
      {/if}
      <label class="askpass-prompt-field">
        <span class="askpass-prompt-field-label">{inputLabel(inputKind)}</span>
        <input
          bind:this={inputEl}
          class="askpass-prompt-input"
          type={inputKind === "username" ? "text" : "password"}
          autocomplete={inputKind === "username" ? "username" : "current-password"}
          bind:value
          disabled={submitting}
        />
      </label>
      <div class="askpass-prompt-actions">
        <button type="button" class="toolbar-button" disabled={submitting} onclick={cancel}>
          Cancel
        </button>
        <button type="button" class="toolbar-button" disabled={submitting} onclick={confirm}>
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .askpass-prompt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1300;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
  }

  .askpass-prompt {
    width: min(420px, calc(100vw - 2 * var(--space-12)));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-10);
    display: grid;
    gap: var(--space-6);
  }

  .askpass-prompt-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .askpass-prompt-body {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .askpass-prompt-host {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .askpass-prompt-field {
    display: grid;
    gap: var(--space-2);
  }

  .askpass-prompt-field-label {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .askpass-prompt-input {
    height: 32px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0 var(--space-4);
    font: inherit;
  }

  .askpass-prompt-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-6);
    margin-top: var(--space-4);
  }
</style>
