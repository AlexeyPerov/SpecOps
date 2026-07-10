<script lang="ts">
  /**
   * Shared empty-state primitive (R3). Renders a title plus an optional
   * description and an optional actions slot, using theme text/surface tokens.
   *
   * Two layouts via `variant`:
   * - `centered` (default): fills its container and centers content — the
   *   Version Control panel vocabulary (clear title + next step when
   *   actionable).
   * - `inline`: a compact block flowing with surrounding content — the
   *   list/panel empty vocabulary (Sessions sidebar, Todo, Console logs).
   *
   * Either an explicit `description` prop or a default `body` slot may carry
   * the secondary line; an `actions` slot carries primary CTAs. Feature
   * copy stays at the call site.
   */
  interface Props {
    title: string;
    description?: string;
    /** `centered` (default) fills + centers; `inline` is a compact block. */
    variant?: "centered" | "inline";
    /** Optional role for the root node (`status`, `alert`, or omitted). */
    role?: "status" | "alert" | null;
    /** Extra class hook for call-site layout adjustments. */
    class?: string;
    children?: import("svelte").Snippet;
    /** Optional body slot (overrides `description`). */
    body?: import("svelte").Snippet;
    /** Optional actions slot (CTA buttons, links). */
    actions?: import("svelte").Snippet;
  }

  let {
    title,
    description,
    variant = "centered",
    role = "status",
    class: className = "",
    children,
    body,
    actions,
  }: Props = $props();
</script>

<div
  class={`empty-state empty-state-${variant} ${className}`}
  {role}
>
  <p class="empty-state-title">{title}</p>
  {#if body}{@render body()}{:else if description}
    <p class="empty-state-description">{description}</p>
  {/if}
  {#if children}{@render children()}{/if}
  {#if actions}
    <div class="empty-state-actions">
      {@render actions()}
    </div>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    color: var(--color-text-secondary);
  }

  /* Centered: fills container and centers content vertically + horizontally. */
  .empty-state-centered {
    flex: 1;
    min-height: 0;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: var(--space-12) var(--space-10);
    max-width: 32rem;
    margin: 0 auto;
    gap: var(--space-4);
  }

  /* Inline: compact block flowing with surrounding list/panel content. */
  .empty-state-inline {
    padding: var(--space-10) var(--space-4);
    text-align: center;
  }

  .empty-state-title {
    margin: 0;
    color: var(--color-text-primary);
    font-weight: 600;
  }

  .empty-state-centered .empty-state-title {
    font-size: var(--font-size-ui);
    line-height: 1.4;
  }

  .empty-state-inline .empty-state-title {
    font-size: var(--font-size-status);
    line-height: 1.4;
  }

  .empty-state-description {
    margin: 0;
    font-size: var(--font-size-ui);
    line-height: 1.5;
  }

  .empty-state-inline .empty-state-description {
    font-size: var(--font-size-status);
  }

  .empty-state-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  /* Centered actions sit centered; inline actions stay left-aligned block. */
  .empty-state-centered .empty-state-actions {
    justify-content: center;
    margin-top: var(--space-2);
  }
</style>
