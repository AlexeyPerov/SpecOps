<script lang="ts">
  /**
   * M2-T6 — collapsible banner showing the OpenCode session summary at the top
   * of the chat. The summary text is the agent-generated compaction summary
   * (produced by `session.summarize` and hydrated into `metadata.summary`).
   * The banner is only rendered when a summary exists; it collapses to a
   * one-line label so it doesn't crowd the transcript.
   */
  interface Props {
    summary: string;
  }

  let { summary }: Props = $props();

  let expanded = $state(false);

  function toggle(): void {
    expanded = !expanded;
  }
</script>

<section class="session-summary" aria-label="Session summary">
  <button
    type="button"
    class="session-summary-header"
    onclick={toggle}
    aria-expanded={expanded}
  >
    <span class="session-summary-label">Summary</span>
    <span class="session-summary-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
  </button>
  {#if expanded}
    <p class="session-summary-body">{summary}</p>
  {/if}
</section>

<style>
  .session-summary {
    border: 1px solid color-mix(in srgb, var(--color-accent) 28%, var(--color-border-subtle));
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-1));
    overflow: hidden;
  }

  .session-summary-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .session-summary-header:hover {
    background: color-mix(in srgb, var(--color-text-secondary) 6%, transparent);
  }

  .session-summary-label {
    font-size: 11px;
    line-height: 1.4;
    font-weight: 600;
    color: var(--color-text-primary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .session-summary-chevron {
    font-size: 10px;
    color: var(--color-text-secondary);
  }

  .session-summary-body {
    margin: 0;
    padding: 0 var(--space-6) var(--space-6);
    font-size: 12px;
    line-height: 1.55;
    color: var(--color-text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
</style>
