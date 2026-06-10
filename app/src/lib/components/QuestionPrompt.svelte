<script lang="ts">
  import {
    registerQuestionPromptRunner,
    type QuestionPromptRequest,
    type QuestionPromptResult,
  } from "../services/questionPrompt";

  interface Props {
    onNotify?: (message: string) => void;
  }

  let { onNotify = () => {} }: Props = $props();

  let open = $state(false);
  let questionPrompt = $state("");
  let questionId = $state("");
  let choices = $state<string[]>([]);
  let selectedChoices = $state<Set<string>>(new Set());
  let validationError = $state("");
  let submitting = $state(false);
  let backdropEl = $state<HTMLDivElement | null>(null);

  let resolvePrompt: ((result: QuestionPromptResult) => void) | null = null;

  async function showPrompt(request: QuestionPromptRequest): Promise<QuestionPromptResult> {
    if (resolvePrompt) {
      resolvePrompt({ type: "reject" });
    }
    return new Promise((resolve) => {
      questionPrompt = request.prompt;
      questionId = request.questionId;
      choices = request.choices ?? [];
      selectedChoices = new Set();
      validationError = "";
      submitting = false;
      resolvePrompt = resolve;
      open = true;
    });
  }

  function finish(result: QuestionPromptResult): void {
    const resolve = resolvePrompt;
    resolvePrompt = null;
    open = false;
    resolve?.(result);
  }

  function toggleChoice(label: string): void {
    const next = new Set(selectedChoices);
    if (next.has(label)) {
      next.delete(label);
    } else {
      next.add(label);
    }
    selectedChoices = next;
    validationError = "";
  }

  function submitReply(): void {
    if (submitting) return;
    if (choices.length > 0 && selectedChoices.size === 0) {
      validationError = "Select at least one option.";
      return;
    }
    submitting = true;
    const answers: string[][] = choices.length > 0 ? [Array.from(selectedChoices)] : [];
    finish({ type: "reply", answers });
  }

  function reject(): void {
    finish({ type: "reject" });
  }

  function handleBackdropPointerDown(event: PointerEvent): void {
    if (event.target === backdropEl) {
      reject();
    }
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      reject();
    }
  }

  $effect(() => {
    registerQuestionPromptRunner(showPrompt);
    return () => registerQuestionPromptRunner(null);
  });
</script>

{#if open}
  <div
    bind:this={backdropEl}
    class="question-prompt-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      class="question-prompt"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="question-prompt-title"
      onkeydown={handleDialogKeydown}
      onclick={(event) => event.stopPropagation()}
      onpointerdown={(event) => event.stopPropagation()}
    >
      <h2 id="question-prompt-title" class="question-prompt-title">Question</h2>
      <p class="question-prompt-text">{questionPrompt}</p>
      {#if choices.length > 0}
        <div class="question-prompt-choices">
          {#each choices as choice}
            <label class="question-prompt-choice">
              <input
                type="checkbox"
                checked={selectedChoices.has(choice)}
                onchange={() => toggleChoice(choice)}
              />
              <span>{choice}</span>
            </label>
          {/each}
        </div>
      {/if}
      {#if validationError}
        <p class="question-prompt-error">{validationError}</p>
      {/if}
      <div class="question-prompt-actions">
        <button
          type="button"
          class="toolbar-button question-reject"
          disabled={submitting}
          onclick={reject}
        >
          Cancel
        </button>
        <button
          type="button"
          class="toolbar-button question-submit"
          disabled={submitting}
          onclick={submitReply}
        >
          Submit
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .question-prompt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
  }

  .question-prompt {
    width: min(420px, calc(100vw - 2 * var(--space-12)));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-10);
    display: grid;
    gap: var(--space-8);
  }

  .question-prompt-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .question-prompt-text {
    margin: 0;
    font-size: var(--font-size-body);
    color: var(--color-text-primary);
    word-break: break-word;
  }

  .question-prompt-choices {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .question-prompt-choice {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--font-size-body);
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .question-prompt-error {
    margin: 0;
    font-size: var(--font-size-body-sm);
    color: var(--color-text-error, #e53e3e);
  }

  .question-prompt-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-6);
    flex-wrap: wrap;
  }

  .question-reject {
    margin-right: auto;
  }
</style>
