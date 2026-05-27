<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    detail = undefined,
    delayMs = 200,
    children,
  }: {
    label: string;
    detail?: string;
    delayMs?: number;
    children: Snippet;
  } = $props();

  let anchorEl: HTMLDivElement | null = $state(null);
  let visible = $state(false);
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let showTimer: ReturnType<typeof setTimeout> | null = null;

  function clearShowTimer(): void {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  }

  function positionTooltip(): void {
    if (!anchorEl) {
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    tooltipX = rect.right + 8;
    tooltipY = rect.top + rect.height / 2;
  }

  function scheduleShow(): void {
    clearShowTimer();
    showTimer = setTimeout(() => {
      positionTooltip();
      visible = true;
      showTimer = null;
    }, delayMs);
  }

  function hide(): void {
    clearShowTimer();
    visible = false;
  }
</script>

<div
  class="hover-tooltip-anchor"
  role="group"
  bind:this={anchorEl}
  onmouseenter={scheduleShow}
  onmouseleave={hide}
  onfocusin={scheduleShow}
  onfocusout={hide}
>
  {@render children()}
</div>

{#if visible}
  <div
    class="hover-tooltip"
    role="tooltip"
    style={`left:${tooltipX}px; top:${tooltipY}px;`}
  >
    <div class="hover-tooltip-label">{label}</div>
    {#if detail}
      <div class="hover-tooltip-detail">{detail}</div>
    {/if}
  </div>
{/if}

<style>
  .hover-tooltip-anchor {
    display: inline-flex;
  }

  .hover-tooltip {
    position: fixed;
    z-index: 1200;
    transform: translateY(-50%);
    max-width: min(360px, calc(100vw - 16px));
    padding: var(--space-4) var(--space-6);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-overlay);
    pointer-events: none;
    display: grid;
    gap: var(--space-2);
  }

  .hover-tooltip-label {
    font-size: 12px;
    line-height: 1.3;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .hover-tooltip-detail {
    font-size: 11px;
    line-height: 1.4;
    color: var(--color-text-secondary);
    word-break: break-all;
  }
</style>
