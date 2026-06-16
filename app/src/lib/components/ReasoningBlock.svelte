<script lang="ts">
  import type { MessageReasoning } from "../ai/chatReasoning";

  interface Props {
    reasoning: MessageReasoning;
    /** Whether the body should be expanded. Controlled by the parent so the
     *  global show/hide-all toggle can override the per-message toggle. */
    expanded: boolean;
    /** Indicates the model is still streaming reasoning for this message. */
    streaming?: boolean;
    onToggle?: () => void;
  }

  let {
    reasoning,
    expanded,
    streaming = false,
    onToggle,
  }: Props = $props();
</script>

<div class="reasoning-block" class:reasoning-block-expanded={expanded}>
  <button
    type="button"
    class="reasoning-header"
    onclick={onToggle}
    aria-expanded={expanded}
    aria-controls={`reasoning-body-${reasoning.id}`}
  >
    <span class="reasoning-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
    <span class="reasoning-label">Reasoning</span>
    {#if streaming}
      <span class="reasoning-status" aria-hidden="true">thinking…</span>
    {/if}
  </button>
  <div class="reasoning-body-wrapper" id={`reasoning-body-${reasoning.id}`}>
    <div class="reasoning-body">
      <p class="reasoning-text">{reasoning.text}</p>
    </div>
  </div>
</div>

<style>
  .reasoning-block {
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-text-secondary) 5%, transparent);
    overflow: hidden;
  }

  .reasoning-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: 11px;
    line-height: 1.4;
    text-align: left;
  }

  .reasoning-header:hover {
    background: color-mix(in srgb, var(--color-text-secondary) 6%, transparent);
  }

  .reasoning-chevron {
    font-size: 10px;
    width: 1ch;
    text-align: center;
    transition: transform var(--motion-fast) var(--easing-standard);
  }

  .reasoning-label {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }

  .reasoning-status {
    margin-left: auto;
    font-style: italic;
    text-transform: none;
    letter-spacing: 0;
    opacity: 0.8;
  }

  /*
   * Animate the body height via grid-template-rows so we don't need to measure
   * the content. 0fr collapses the single track to its min-content (0 for a
   * div with overflow hidden); 1fr reveals it. The wrapper holds the grid and
   * clips overflow during the transition.
   */
  .reasoning-body-wrapper {
    display: grid;
    grid-template-rows: 0fr;
    transition:
      grid-template-rows var(--motion-medium) var(--easing-standard),
      opacity var(--motion-medium) var(--easing-standard);
    opacity: 0;
  }

  .reasoning-block-expanded .reasoning-body-wrapper {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  .reasoning-body {
    min-height: 0;
    overflow: hidden;
    padding: 0 var(--space-4);
  }

  .reasoning-block-expanded .reasoning-body {
    padding-bottom: var(--space-4);
  }

  .reasoning-text {
    margin: 0;
    font-size: 12px;
    line-height: 1.55;
    font-style: italic;
    color: var(--color-text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  @media (prefers-reduced-motion: reduce) {
    .reasoning-chevron {
      transition: none;
    }
    .reasoning-body-wrapper {
      transition: none;
    }
  }
</style>
