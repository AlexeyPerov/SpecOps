<script lang="ts">
  import type { MessageSubtask } from "../ai/chatSubtasks";

  interface Props {
    subtask: MessageSubtask;
    /** Controlled expanded state so a parent can drive collapse globally. */
    expanded: boolean;
    onToggle?: () => void;
  }

  let { subtask, expanded, onToggle }: Props = $props();

  function statusLabel(status: MessageSubtask["status"]): string {
    if (status === "running") return "Running";
    if (status === "completed") return "Completed";
    return "Failed";
  }

  function statusIcon(status: MessageSubtask["status"]): string {
    if (status === "running") return "⏳";
    if (status === "completed") return "✓";
    return "✗";
  }

  /** Has any expandable detail (prompt or output/error) worth showing. */
  let hasDetails = $derived(
    Boolean(
      (subtask.prompt && subtask.prompt.trim().length > 0) ||
        (subtask.output && subtask.output.trim().length > 0) ||
        (subtask.error && subtask.error.trim().length > 0),
    ),
  );

  /** First non-empty line of the output as a one-line summary for the header. */
  let outputSummary = $derived.by(() => {
    const text = (subtask.output ?? "").trim();
    if (text.length === 0) {
      return "";
    }
    const firstLine = text.split("\n", 1)[0];
    return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  });
</script>

<div
  class="subtask-card"
  class:subtask-card-running={subtask.status === "running"}
  class:subtask-card-completed={subtask.status === "completed"}
  class:subtask-card-failed={subtask.status === "failed"}
>
  <button
    type="button"
    class="subtask-header"
    onclick={onToggle}
    aria-expanded={hasDetails ? expanded : undefined}
    disabled={!hasDetails}
  >
    <span class="subtask-status-icon" aria-hidden="true">{statusIcon(subtask.status)}</span>
    <span class="subtask-agent">{subtask.agent}</span>
    <span class="subtask-status-label">{statusLabel(subtask.status)}</span>
    {#if outputSummary}
      <span class="subtask-summary" aria-hidden="true">{outputSummary}</span>
    {/if}
    {#if hasDetails}
      <span class="subtask-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
    {/if}
  </button>

  <div class="subtask-body-wrapper">
    <div class="subtask-body">
      {#if subtask.description}
        <p class="subtask-description">{subtask.description}</p>
      {/if}
      {#if subtask.prompt}
        <div class="subtask-section">
          <p class="subtask-section-label">Prompt</p>
          <pre class="subtask-pre">{subtask.prompt}</pre>
        </div>
      {/if}
      {#if subtask.error}
        <div class="subtask-section subtask-section-error">
          <p class="subtask-section-label">Error</p>
          <pre class="subtask-pre">{subtask.error}</pre>
        </div>
      {:else if subtask.output}
        <div class="subtask-section">
          <p class="subtask-section-label">Output</p>
          <pre class="subtask-pre">{subtask.output}</pre>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .subtask-card {
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-text-secondary) 5%, transparent);
    overflow: hidden;
  }

  .subtask-card-running {
    border-color: color-mix(in srgb, var(--color-accent) 35%, var(--color-border-subtle));
  }

  .subtask-card-failed {
    border-color: color-mix(in srgb, var(--color-error) 40%, var(--color-border-subtle));
  }

  .subtask-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    cursor: pointer;
    font-size: 11px;
    line-height: 1.4;
    text-align: left;
  }

  .subtask-header:disabled {
    cursor: default;
  }

  .subtask-header:not(:disabled):hover {
    background: color-mix(in srgb, var(--color-text-secondary) 6%, transparent);
  }

  .subtask-status-icon {
    font-size: 10px;
    width: 1ch;
    text-align: center;
  }

  .subtask-card-completed .subtask-status-icon {
    color: var(--color-success);
  }

  .subtask-card-failed .subtask-status-icon {
    color: var(--color-error);
  }

  .subtask-card-running .subtask-status-icon {
    color: var(--color-text-secondary);
  }

  .subtask-agent {
    font-weight: 600;
    font-family: monospace;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subtask-status-label {
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 10px;
    flex-shrink: 0;
  }

  .subtask-card-completed .subtask-status-label {
    color: var(--color-success);
  }

  .subtask-card-failed .subtask-status-label {
    color: var(--color-error);
  }

  .subtask-summary {
    color: var(--color-text-secondary);
    font-style: italic;
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subtask-chevron {
    color: var(--color-text-secondary);
    font-size: 10px;
    flex-shrink: 0;
    transition: transform var(--motion-fast) var(--easing-standard);
  }

  /*
   * Animate the body height via grid-template-rows so we don't need to measure
   * the content (same technique as ReasoningBlock). Only revealed when the
   * parent reports an expanded state.
   */
  .subtask-body-wrapper {
    display: grid;
    grid-template-rows: 0fr;
    transition:
      grid-template-rows var(--motion-medium) var(--easing-standard),
      opacity var(--motion-medium) var(--easing-standard);
    opacity: 0;
  }

  .subtask-header[aria-expanded="true"] ~ .subtask-body-wrapper {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  .subtask-body {
    min-height: 0;
    overflow: hidden;
    padding: 0 var(--space-4) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .subtask-description {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--color-text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .subtask-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .subtask-section-label {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .subtask-section-error .subtask-section-label {
    color: var(--color-error);
  }

  .subtask-pre {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--color-surface-0, var(--color-surface-1));
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    max-height: 240px;
    overflow-y: auto;
  }

  @media (prefers-reduced-motion: reduce) {
    .subtask-chevron,
    .subtask-body-wrapper {
      transition: none;
    }
  }
</style>
