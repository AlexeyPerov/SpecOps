<script lang="ts">
  import {
    answerQuestionPrompt,
    type PendingQuestionPrompt,
  } from "../services/questionPrompt";

  interface Props {
    entry: PendingQuestionPrompt;
  }

  type QuestionPayload = {
    multiSelect?: boolean;
    allowFreeText?: boolean;
    options?: { label: string; description?: string; preview?: string }[];
  };

  let { entry }: Props = $props();

  let selectedChoices = $state<Set<string>>(new Set());
  let freeform = $state("");
  let validationError = $state("");
  let submitting = $state(false);

  const payload = $derived(entry.request.payload as QuestionPayload | undefined);
  const choices = $derived(entry.request.choices ?? []);
  const multiSelect = $derived(payload?.multiSelect !== false);
  const allowFreeText = $derived(payload?.allowFreeText === true);
  const optionDescriptions = $derived<Record<string, string>>(
    Object.fromEntries(
      (payload?.options ?? []).map((option) => [
        option.label,
        typeof option.description === "string" ? option.description : "",
      ]),
    ),
  );
  const previewsUnavailable = $derived(
    (payload?.options ?? []).some((option) => typeof option.preview === "string"),
  );
  const titleId = $derived(`question-request-title-${entry.seq}`);
  const choiceGroupName = $derived(`question-request-choice-${entry.seq}`);

  function toggleChoice(label: string): void {
    const next = new Set(selectedChoices);
    if (!multiSelect) next.clear();
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
    if (choices.length > 0 && selectedChoices.size === 0 && !freeform.trim()) {
      validationError = "Select at least one option.";
      return;
    }
    submitting = true;
    const answers: string[][] = freeform.trim()
      ? [[freeform.trim()]]
      : choices.length > 0
        ? [Array.from(selectedChoices)]
        : [[freeform]];
    answerQuestionPrompt(entry, { type: "reply", answers });
  }

  function reject(): void {
    if (submitting) return;
    submitting = true;
    answerQuestionPrompt(entry, { type: "reject" });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      reject();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const target = event.target as HTMLElement | null;
    const inTextarea = target instanceof HTMLTextAreaElement;
    // Enter submits from a choice; inside the answer box Cmd/Ctrl+Enter does,
    // so plain Enter can still insert a line break.
    if (target instanceof HTMLInputElement || (inTextarea && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      submitReply();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="session-request-card question-request-card"
  role="group"
  aria-labelledby={titleId}
  data-session-id={entry.sessionId}
  onkeydown={handleKeydown}
>
  <p id={titleId} class="session-request-card-title">Question</p>
  <p class="session-request-card-label">{entry.request.prompt}</p>
  {#if choices.length > 0}
    <div class="question-request-choices">
      {#each choices as choice (choice)}
        <label class="question-request-choice">
          <input
            type={multiSelect ? "checkbox" : "radio"}
            name={choiceGroupName}
            checked={selectedChoices.has(choice)}
            disabled={submitting}
            onchange={() => toggleChoice(choice)}
          />
          <span>{choice}{#if optionDescriptions[choice]} — {optionDescriptions[choice]}{/if}</span>
        </label>
      {/each}
    </div>
  {/if}
  {#if previewsUnavailable}
    <p class="question-request-hint">Option previews are unavailable; choose using the text descriptions.</p>
  {/if}
  {#if validationError}
    <p class="question-request-error" role="alert">{validationError}</p>
  {/if}
  {#if choices.length === 0 || allowFreeText}
    <label class="question-request-answer">
      <span>{choices.length ? "Other answer" : "Answer"}</span>
      <textarea aria-label="Answer" rows="2" disabled={submitting} bind:value={freeform}></textarea>
    </label>
  {/if}
  <div class="session-request-card-actions">
    <button
      type="button"
      class="btn btn-secondary question-reject"
      disabled={submitting}
      onclick={reject}
    >
      Cancel
    </button>
    <button
      type="button"
      class="btn btn-primary question-submit"
      disabled={submitting}
      onclick={submitReply}
    >
      Submit
    </button>
  </div>
</section>

<style>
  .session-request-card {
    display: grid;
    gap: var(--space-6);
    padding: var(--space-6);
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-border-subtle));
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    min-width: 0;
  }

  .session-request-card-title {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: 1.4;
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .session-request-card-label {
    margin: 0;
    font-size: var(--font-size-md);
    line-height: 1.5;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }

  .question-request-choices {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .question-request-choice {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--font-size-md);
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .question-request-hint {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }

  .question-request-error {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-error);
  }

  .question-request-answer {
    display: grid;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }

  .question-request-answer textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--font-size-md);
  }

  .session-request-card-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .question-reject {
    margin-right: auto;
  }
</style>
