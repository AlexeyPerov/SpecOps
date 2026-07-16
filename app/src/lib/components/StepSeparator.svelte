<script lang="ts">
  import type { MessageStepBoundary } from "../ai/chatSteps";
  import { cacheTotal, formatCost, formatTokenCount } from "../ai/chatTokenFormat";

  interface Props {
    boundary: MessageStepBoundary;
  }

  let { boundary }: Props = $props();

  function statusLabel(status: MessageStepBoundary["status"]): string {
    if (status === "running") return "running";
    if (status === "failed") return "failed";
    return "done";
  }
</script>

<div
  class="step-separator"
  class:step-separator-running={boundary.status === "running"}
  class:step-separator-completed={boundary.status === "completed"}
  class:step-separator-failed={boundary.status === "failed"}
  role="separator"
  aria-label={`Step ${boundary.stepNumber} — ${statusLabel(boundary.status)}`}
>
  <span class="step-rule" aria-hidden="true"></span>
  <span class="step-label">
    <span class="step-number">Step {boundary.stepNumber}</span>
    {#if boundary.status === "running"}
      <span class="step-status step-status-running" aria-hidden="true">
        <span class="step-dot"></span>running
      </span>
    {:else if boundary.status === "failed"}
      <span class="step-status step-status-failed" aria-hidden="true">✗ failed</span>
    {/if}
    {#if boundary.tokens}
      <span class="step-tokens" title="input / output / cache tokens">
        <span class="step-token-field"><span class="step-token-key">in</span>{formatTokenCount(boundary.tokens.input)}</span>
        <span class="step-token-field"><span class="step-token-key">out</span>{formatTokenCount(boundary.tokens.output)}</span>
        <span class="step-token-field"><span class="step-token-key">cache</span>{formatTokenCount(cacheTotal(boundary.tokens))}</span>
      </span>
    {/if}
    {#if boundary.cost !== undefined}
      <span class="step-cost">{formatCost(boundary.cost)}</span>
    {/if}
  </span>
  <span class="step-rule" aria-hidden="true"></span>
</div>

<style>
  .step-separator {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
  }

  .step-rule {
    flex: 1;
    height: 1px;
    background: var(--color-border-subtle);
    min-width: var(--space-4);
  }

  .step-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
    font-size: 10px;
    line-height: 1.4;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .step-number {
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .step-status {
    font-style: italic;
    text-transform: none;
    letter-spacing: 0;
  }

  .step-status-running {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-secondary);
  }

  .step-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-accent);
    animation: step-dot-pulse 1.3s ease-in-out infinite;
  }

  .step-status-failed {
    color: var(--color-error);
  }

  @keyframes step-dot-pulse {
    0%,
    100% {
      opacity: 0.4;
      transform: scale(0.85);
    }
    50% {
      opacity: 1;
      transform: scale(1.15);
    }
  }

  .step-tokens {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-family: monospace;
    text-transform: none;
    letter-spacing: 0;
  }

  .step-token-field {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
  }

  .step-token-key {
    color: var(--color-text-secondary);
    opacity: 0.7;
    font-size: 9px;
  }

  .step-cost {
    font-family: monospace;
    text-transform: none;
    letter-spacing: 0;
    color: var(--color-text-secondary);
    opacity: 0.85;
  }

  .step-separator-running .step-number,
  .step-separator-running .step-rule {
    color: color-mix(in srgb, var(--color-accent) 60%, var(--color-text-secondary));
    background: color-mix(in srgb, var(--color-accent) 30%, var(--color-border-subtle));
  }

  .step-separator-running .step-rule {
    background: color-mix(in srgb, var(--color-accent) 30%, var(--color-border-subtle));
  }

  .step-separator-failed .step-rule {
    background: color-mix(in srgb, var(--color-error) 35%, var(--color-border-subtle));
  }

  @media (prefers-reduced-motion: reduce) {
    .step-dot {
      animation: none;
    }
  }
</style>
