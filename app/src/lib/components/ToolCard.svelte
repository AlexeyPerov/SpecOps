<script lang="ts">
  import type { ToolCallRecord } from "../domain/contracts";

  interface Props {
    toolCall: ToolCallRecord;
  }

  let { toolCall }: Props = $props();

  let expanded = $state(false);

  function statusLabel(status: ToolCallRecord["status"]): string {
    if (status === "pending") return "Running…";
    if (status === "success") return "Done";
    return "Failed";
  }

  function statusIcon(status: ToolCallRecord["status"]): string {
    if (status === "pending") return "⏳";
    if (status === "success") return "✓";
    return "✗";
  }

  function formatOutput(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function formatInput(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
</script>

<div
  class="tool-card"
  class:tool-card-pending={toolCall.status === "pending"}
  class:tool-card-success={toolCall.status === "success"}
  class:tool-card-failure={toolCall.status === "failure"}
>
  <button
    type="button"
    class="tool-card-header"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
  >
    <span class="tool-card-status-icon">{statusIcon(toolCall.status)}</span>
    <span class="tool-card-name">{toolCall.toolName}</span>
    <span class="tool-card-status-label">{statusLabel(toolCall.status)}</span>
    <span class="tool-card-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
  </button>

  {#if expanded}
    <div class="tool-card-details">
      {#if toolCall.input !== undefined && toolCall.input !== null}
        <details>
          <summary>Input</summary>
          <pre class="tool-card-pre">{formatInput(toolCall.input)}</pre>
        </details>
      {/if}

      {#if toolCall.progress !== undefined && toolCall.progress !== null}
        <details>
          <summary>Progress</summary>
          <pre class="tool-card-pre">{formatOutput(toolCall.progress)}</pre>
        </details>
      {/if}

      {#if toolCall.output !== undefined && toolCall.output !== null}
        <details>
          <summary>Output</summary>
          <pre class="tool-card-pre">{formatOutput(toolCall.output)}</pre>
        </details>
      {/if}

      {#if toolCall.status === "pending" && toolCall.output === undefined && toolCall.input === undefined}
        <p class="tool-card-empty">No details available yet.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool-card {
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    overflow: hidden;
  }

  .tool-card-pending {
    border-color: color-mix(in srgb, var(--color-accent) 35%, var(--color-border-subtle));
  }

  .tool-card-failure {
    border-color: color-mix(in srgb, #e06c75 40%, var(--color-border-subtle));
  }

  .tool-card-header {
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

  .tool-card-header:hover {
    background: color-mix(in srgb, var(--color-text-secondary) 6%, var(--color-surface-1));
  }

  .tool-card-status-icon {
    font-size: 10px;
    width: 1ch;
    text-align: center;
  }

  .tool-card-success .tool-card-status-icon {
    color: #98c379;
  }

  .tool-card-failure .tool-card-status-icon {
    color: #e06c75;
  }

  .tool-card-pending .tool-card-status-icon {
    color: var(--color-text-secondary);
  }

  .tool-card-name {
    font-weight: 600;
    font-family: monospace;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-card-status-label {
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 10px;
  }

  .tool-card-success .tool-card-status-label {
    color: #98c379;
  }

  .tool-card-failure .tool-card-status-label {
    color: #e06c75;
  }

  .tool-card-chevron {
    color: var(--color-text-secondary);
    font-size: 10px;
  }

  .tool-card-details {
    padding: 0 var(--space-4) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .tool-card-details details {
    font-size: 11px;
  }

  .tool-card-details summary {
    cursor: pointer;
    color: var(--color-text-secondary);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: var(--space-1);
  }

  .tool-card-pre {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--color-surface-0, var(--color-surface-1));
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    max-height: 200px;
    overflow-y: auto;
  }

  .tool-card-empty {
    margin: 0;
    font-size: 11px;
    color: var(--color-text-secondary);
    font-style: italic;
  }
</style>
