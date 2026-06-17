<script lang="ts">
  import type { ChatSessionTotals } from "../ai/chatSteps";
  import { cacheTotal, formatCost, formatTokenCount } from "../ai/chatTokenFormat";

  interface Props {
    totals: ChatSessionTotals;
  }

  let { totals }: Props = $props();

  // Title gives the full breakdown on hover; the visible label is the compact
  // running cost so the header stays scannable.
  let title = $derived(
    [
      `input: ${totals.tokens.input.toLocaleString()}`,
      `output: ${totals.tokens.output.toLocaleString()}`,
      `cache read: ${totals.tokens.cache.read.toLocaleString()}`,
      `cache write: ${totals.tokens.cache.write.toLocaleString()}`,
      `reasoning: ${totals.tokens.reasoning.toLocaleString()}`,
      `cost: $${totals.cost.toFixed(4)}`,
    ].join("\n"),
  );
</script>

<span class="session-total-badge" title={title} aria-label={`Session cost ${formatCost(totals.cost)}`}>
  <span class="session-total-tokens">
    <span class="session-total-field">
      <span class="session-total-key">in</span>{formatTokenCount(totals.tokens.input)}
    </span>
    <span class="session-total-field">
      <span class="session-total-key">out</span>{formatTokenCount(totals.tokens.output)}
    </span>
    <span class="session-total-field">
      <span class="session-total-key">cache</span>{formatTokenCount(cacheTotal(totals.tokens))}
    </span>
  </span>
  <span class="session-total-cost">{formatCost(totals.cost)}</span>
</span>

<style>
  .session-total-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    font-size: 10px;
    line-height: 1.4;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .session-total-tokens {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-3);
    font-family: monospace;
  }

  .session-total-field {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
  }

  .session-total-key {
    font-size: 9px;
    opacity: 0.7;
  }

  .session-total-cost {
    font-family: monospace;
    opacity: 0.9;
  }

  /* On narrow panels, collapse to just the cost so the title still carries the
     full token breakdown via the hover tooltip. */
  @container (max-width: 520px) {
    .session-total-tokens {
      display: none;
    }
  }
</style>
