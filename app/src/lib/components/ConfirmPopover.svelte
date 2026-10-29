<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import {
    placeConfirmPopover,
    type ConfirmAnchor,
    type ConfirmPopoverPlacement,
  } from "../services/confirmDialogUi";

  /**
   * Non-modal confirm bubble shown beside what it is about (see
   * `ConfirmRequest.anchor`). No backdrop: Escape, a click outside, or a
   * window resize cancels; the primary button takes focus so Enter confirms.
   */
  interface Props {
    anchor: ConfirmAnchor;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    danger: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }

  let { anchor, title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: Props =
    $props();

  let popoverEl = $state<HTMLDivElement | null>(null);
  let confirmButtonEl = $state<HTMLButtonElement | null>(null);
  let placement = $state<ConfirmPopoverPlacement | null>(null);
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const titleId = `confirm-popover-title-${Math.random().toString(36).slice(2)}`;

  $effect(() => {
    const el = popoverEl;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    placement = placeConfirmPopover(
      anchor,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    void tick().then(() => confirmButtonEl?.focus());
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancel();
      return;
    }
    if (event.key === "Tab" && popoverEl) {
      const buttons = Array.from(popoverEl.querySelectorAll<HTMLButtonElement>("button"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault();
      const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.target instanceof Node && popoverEl?.contains(event.target)) return;
    onCancel();
  }

  function handleResize(): void {
    onCancel();
  }

  window.addEventListener("keydown", handleKeydown, true);
  window.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("resize", handleResize);

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown, true);
    window.removeEventListener("pointerdown", handlePointerDown, true);
    window.removeEventListener("resize", handleResize);
    if (previouslyFocused?.isConnected) previouslyFocused.focus?.();
  });
</script>

<div
  bind:this={popoverEl}
  class="confirm-popover"
  class:confirm-popover-placed={placement !== null}
  data-side={placement?.side ?? "right"}
  style={placement
    ? `left:${placement.left}px; top:${placement.top}px; --confirm-popover-arrow:${placement.arrow}px;`
    : undefined}
  role="alertdialog"
  aria-labelledby={titleId}
  tabindex="-1"
>
  <div id={titleId} class="confirm-popover-title">{title}</div>
  <p class="confirm-popover-message">{message}</p>
  <div class="confirm-popover-actions">
    <button type="button" class="btn btn-sm btn-secondary" onclick={onCancel}>{cancelLabel}</button>
    <button
      bind:this={confirmButtonEl}
      type="button"
      class={danger ? "btn btn-sm btn-danger" : "btn btn-sm btn-primary"}
      onclick={onConfirm}
    >
      {confirmLabel}
    </button>
  </div>
</div>

<style>
  .confirm-popover {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 1150;
    width: max-content;
    max-width: min(320px, calc(100vw - 16px));
    padding: var(--space-6);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    /* Measured off-screen first, then moved into place. */
    visibility: hidden;
  }

  .confirm-popover-placed {
    visibility: visible;
  }

  .confirm-popover:focus {
    outline: none;
  }

  /* Arrow: a rotated square sharing the bubble's border, on the anchor side. */
  .confirm-popover::before {
    content: "";
    position: absolute;
    width: 8px;
    height: 8px;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    transform: rotate(45deg);
  }

  .confirm-popover[data-side="right"]::before {
    left: -5px;
    top: calc(var(--confirm-popover-arrow, 16px) - 5px);
    border-top-color: transparent;
    border-right-color: transparent;
  }

  .confirm-popover[data-side="left"]::before {
    right: -5px;
    top: calc(var(--confirm-popover-arrow, 16px) - 5px);
    border-bottom-color: transparent;
    border-left-color: transparent;
  }

  .confirm-popover[data-side="below"]::before {
    top: -5px;
    left: calc(var(--confirm-popover-arrow, 16px) - 5px);
    border-bottom-color: transparent;
    border-right-color: transparent;
  }

  .confirm-popover[data-side="above"]::before {
    bottom: -5px;
    left: calc(var(--confirm-popover-arrow, 16px) - 5px);
    border-top-color: transparent;
    border-left-color: transparent;
  }

  .confirm-popover-title {
    font-size: var(--font-size-ui);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .confirm-popover-message {
    margin: 0;
    max-height: 160px;
    overflow-y: auto;
    font-size: var(--font-size-ui);
    line-height: 1.45;
    color: var(--color-text-secondary);
    white-space: pre-line;
    word-break: break-word;
  }

  .confirm-popover-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-4);
  }
</style>
