<script lang="ts">
  import { tick } from "svelte";

  /**
   * Shared dialog chrome (R4). Provides the backdrop + centered panel,
   * `role="dialog"` / `aria-modal="true"`, Escape + optional backdrop
   * dismiss, and title/body/actions regions. This is the presentational
   * shell only — the promise-based confirm API lands in a later milestone.
   *
   * Callers keep their own `open` state and service wiring (e.g. the
   * self-registering prompt runners). When `open` is false, nothing renders.
   *
   * Regions:
   * - `title` prop → `<h2 id={labelledbyId}>` (drives `aria-labelledby`).
   * - default slot → body (inputs, warnings, lists).
   * - `actions` snippet → footer action row (Cancel / confirm buttons).
   *
   * Accessibility:
   * - Escape calls `onDismiss` when provided.
   * - Backdrop pointer-down calls `onDismiss` when `dismissOnBackdrop` is set
   *   (default true). Callers that must suppress dismiss while busy pass false.
   * - On open, focus moves into the panel; the previously-focused element is
   *   restored when the dialog closes (best-effort).
   */
  interface Props {
    open: boolean;
    title: string;
    /** Invoked on Escape / backdrop dismiss. Omit to make the dialog non-dismissable. */
    onDismiss?: () => void;
    /** Dismiss when the backdrop (not the panel) receives a pointerdown. */
    dismissOnBackdrop?: boolean;
    /** Panel max-width in px (clamped to viewport). */
    width?: number;
    /** Extra class on the panel for call-site layout tweaks. */
    panelClass?: string;
    /** Optional id for the title element; auto-generated when omitted. */
    titleId?: string;
    children?: import("svelte").Snippet;
    actions?: import("svelte").Snippet;
  }

  let {
    open,
    title,
    onDismiss,
    dismissOnBackdrop = true,
    width = 420,
    panelClass = "",
    titleId,
    children,
    actions,
  }: Props = $props();

  let panelEl = $state<HTMLDivElement | null>(null);
  let previouslyFocused: HTMLElement | null = null;

  // Stable id so multiple shells can coexist without clashing aria-labelledby.
  const autoTitleId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `dialog-title-${crypto.randomUUID()}`
      : `dialog-title-${Math.random().toString(36).slice(2)}`;
  const resolvedTitleId = $derived(titleId ?? autoTitleId);
  const panelWidth = $derived(`min(${width}px, calc(100vw - 2 * var(--space-12)))`);

  function handleBackdropPointerDown(event: PointerEvent): void {
    if (!dismissOnBackdrop || !onDismiss) {
      return;
    }
    // Only dismiss when the backdrop itself (not the panel or its children) is
    // hit. `currentTarget` is the backdrop (the listener host) regardless of
    // event delegation, so it survives Svelte 5's delegated listener setup.
    if (event.target === event.currentTarget) {
      onDismiss();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && onDismiss) {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    }
  }

  // Focus management: capture the prior active element on open, focus into the
  // dialog, and restore focus on close. Callers that need to focus a specific
  // control can do so themselves after open — if focus is already inside the
  // panel by the time this runs, we leave it alone (no focus stealing).
  $effect(() => {
    if (!open) {
      // Restore focus once when transitioning to closed.
      if (previouslyFocused) {
        previouslyFocused.focus?.();
        previouslyFocused = null;
      }
      return;
    }
    previouslyFocused = (document.activeElement as HTMLElement) ?? null;
    void tick().then(() => {
      // If a caller already moved focus into the dialog, respect it.
      const active = document.activeElement as HTMLElement | null;
      if (active && panelEl?.contains(active)) {
        return;
      }
      // Otherwise prefer a focusable child (input/button); fall back to panel.
      const focusable = panelEl?.querySelector<HTMLElement>(
        "input, button:not([disabled]), [tabindex]:not([tabindex='-1']), textarea, select, a[href]",
      );
      (focusable ?? panelEl)?.focus();
    });
  });
</script>

{#if open}
  <div
    class="dialog-shell-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      bind:this={panelEl}
      class={`dialog-shell-panel ${panelClass}`}
      style={`--dialog-shell-width:${panelWidth};`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={resolvedTitleId}
      tabindex="-1"
      onkeydown={handleKeydown}
    >
      <h2 id={resolvedTitleId} class="dialog-shell-title">{title}</h2>
      {#if children}{@render children()}{/if}
      {#if actions}
        <div class="dialog-shell-actions">
          {@render actions()}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .dialog-shell-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
    backdrop-filter: blur(var(--blur-overlay));
    -webkit-backdrop-filter: blur(var(--blur-overlay));
    padding: var(--space-10);
  }

  .dialog-shell-panel {
    width: var(--dialog-shell-width);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-10);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    /* Keep the panel clear of the viewport edges on short screens. */
    max-height: calc(100vh - 2 * var(--space-12));
    overflow-y: auto;
  }

  .dialog-shell-panel:focus {
    outline: none;
  }

  .dialog-shell-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .dialog-shell-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-6);
    margin-top: var(--space-2);
  }
</style>
