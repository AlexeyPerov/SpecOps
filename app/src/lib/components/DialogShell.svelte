<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { placeAnchoredPopover, type AnchoredPlacement, type PromptAnchor } from "../services/promptAnchor";

  /**
   * Shared dialog chrome (R4). Provides the backdrop + centered panel,
   * `role="dialog"` / `aria-modal="true"`, Escape + optional backdrop
   * dismiss, focus trap, and title/body/actions regions. This is the
   * presentational shell only — the promise-based confirm API lands in a
   * later milestone.
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
   * - Escape (window capture) calls `onDismiss` when provided.
   * - Tab / Shift+Tab cycle within focusable elements inside the panel.
   * - Backdrop pointer-down calls `onDismiss` when `dismissOnBackdrop` is set
   *   (default true). Callers that must suppress dismiss while busy pass false.
   * - On open, focus moves into the panel; the previously-focused element is
   *   restored when the dialog closes or the component unmounts (best-effort).
   *
   * Anchored mode (`anchor` set): the panel opens as a non-modal bubble beside
   * the anchor rect, with an arrow and no dimmed backdrop. A pointer-down
   * outside the panel or a window resize dismisses it (same `onDismiss` /
   * `dismissOnBackdrop` rules as the backdrop).
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
    /** Viewport rect to open beside, as a bubble without a backdrop. */
    anchor?: PromptAnchor | null;
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
    anchor = null,
  }: Props = $props();

  let panelEl = $state<HTMLDivElement | null>(null);
  let placement = $state<AnchoredPlacement | null>(null);
  let previouslyFocused: HTMLElement | null = null;

  const FOCUSABLE_SELECTOR =
    "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1']), [contenteditable]:not([contenteditable='false'])";

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

  function focusableInPanel(panel: HTMLElement): HTMLElement[] {
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }

  function isTopmostDialogPanel(panel: HTMLElement): boolean {
    const panels = document.querySelectorAll(".dialog-shell-panel");
    return panels.length === 0 || panels[panels.length - 1] === panel;
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (!onDismiss || !panelEl) {
        return;
      }
      // Stacked shells all listen on window capture; only the topmost panel
      // (last in DOM order) may dismiss, and stopImmediatePropagation keeps a
      // lower shell from also handling the same Escape (F74).
      if (!isTopmostDialogPanel(panelEl)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onDismiss();
      return;
    }

    if (event.key !== "Tab" || !panelEl) {
      return;
    }

    // Only the topmost dialog traps Tab — a lower shell must not yank focus
    // out of a ConfirmDialog stacked above an EntryNamePrompt.
    if (!isTopmostDialogPanel(panelEl)) {
      return;
    }

    const focusable = focusableInPanel(panelEl);
    if (focusable.length === 0) {
      event.preventDefault();
      panelEl.focus();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey) {
      if (active === first || !active || !panelEl.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !active || !panelEl.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  function restorePreviousFocus(): void {
    if (!previouslyFocused) {
      return;
    }
    previouslyFocused.focus?.();
    previouslyFocused = null;
  }

  // Focus management: capture the prior active element on open, focus into the
  // dialog, trap Tab within the panel via a window capture listener, and
  // restore focus on close. Callers that need to focus a specific control can
  // do so themselves after open — if focus is already inside the panel by the
  // time this runs, we leave it alone (no focus stealing).
  $effect(() => {
    if (!open) {
      restorePreviousFocus();
      return;
    }

    previouslyFocused = (document.activeElement as HTMLElement) ?? null;
    window.addEventListener("keydown", handleWindowKeydown, true);

    void tick().then(() => {
      // If a caller already moved focus into the dialog, respect it.
      const active = document.activeElement as HTMLElement | null;
      if (active && panelEl?.contains(active)) {
        return;
      }
      // Otherwise prefer a focusable child (input/button); fall back to panel.
      const focusable = panelEl ? focusableInPanel(panelEl)[0] : null;
      (focusable ?? panelEl)?.focus();
    });

    return () => {
      window.removeEventListener("keydown", handleWindowKeydown, true);
    };
  });

  // Anchored mode: measure the rendered bubble, then move it beside the anchor.
  $effect(() => {
    const el = panelEl;
    if (!open || !anchor || !el) {
      placement = null;
      return;
    }
    const rect = el.getBoundingClientRect();
    placement = placeAnchoredPopover(
      anchor,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
  });

  function handleOutsidePointerDown(event: PointerEvent): void {
    if (!dismissOnBackdrop || !onDismiss || !panelEl || !isTopmostDialogPanel(panelEl)) {
      return;
    }
    if (event.target instanceof Node && panelEl.contains(event.target)) {
      return;
    }
    onDismiss();
  }

  function handleResize(): void {
    onDismiss?.();
  }

  $effect(() => {
    if (!open || !anchor) {
      return;
    }
    window.addEventListener("pointerdown", handleOutsidePointerDown, true);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      window.removeEventListener("resize", handleResize);
    };
  });

  onDestroy(() => {
    restorePreviousFocus();
  });
</script>

{#snippet panelContent()}
  <h2 id={resolvedTitleId} class="dialog-shell-title">{title}</h2>
  {#if children}{@render children()}{/if}
  {#if actions}
    <div class="dialog-shell-actions">
      {@render actions()}
    </div>
  {/if}
{/snippet}

{#if open && anchor}
  <div
    bind:this={panelEl}
    class={`dialog-shell-panel dialog-shell-anchored ${panelClass}`}
    class:dialog-shell-placed={placement !== null}
    data-side={placement?.side ?? "right"}
    style={`--dialog-shell-width:${panelWidth};${placement ? ` left:${placement.left}px; top:${placement.top}px; --dialog-shell-arrow:${placement.arrow}px;` : ""}`}
    role="dialog"
    aria-modal="false"
    aria-labelledby={resolvedTitleId}
    tabindex="-1"
  >
    {@render panelContent()}
  </div>
{:else if open}
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
    >
      {@render panelContent()}
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

  /* Anchored bubble: no backdrop, placed beside the anchor after measuring. */
  .dialog-shell-anchored {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 1200;
    width: min(var(--dialog-shell-width), calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    padding: var(--space-6);
    gap: var(--space-4);
    overflow: visible;
    opacity: 0;
  }

  .dialog-shell-anchored.dialog-shell-placed {
    opacity: 1;
  }

  .dialog-shell-anchored .dialog-shell-title {
    font-size: var(--font-size-ui);
  }

  .dialog-shell-anchored .dialog-shell-actions {
    gap: var(--space-4);
    margin-top: 0;
  }

  /* Arrow: a rotated square sharing the panel border, on the anchor side. */
  .dialog-shell-anchored::before {
    content: "";
    position: absolute;
    width: 8px;
    height: 8px;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    transform: rotate(45deg);
  }

  .dialog-shell-anchored[data-side="right"]::before {
    left: -5px;
    top: calc(var(--dialog-shell-arrow, 16px) - 5px);
    border-top-color: transparent;
    border-right-color: transparent;
  }

  .dialog-shell-anchored[data-side="left"]::before {
    right: -5px;
    top: calc(var(--dialog-shell-arrow, 16px) - 5px);
    border-bottom-color: transparent;
    border-left-color: transparent;
  }

  .dialog-shell-anchored[data-side="below"]::before {
    top: -5px;
    left: calc(var(--dialog-shell-arrow, 16px) - 5px);
    border-bottom-color: transparent;
    border-right-color: transparent;
  }

  .dialog-shell-anchored[data-side="above"]::before {
    bottom: -5px;
    left: calc(var(--dialog-shell-arrow, 16px) - 5px);
    border-top-color: transparent;
    border-left-color: transparent;
  }
</style>
