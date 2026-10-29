/**
 * M3 (R4) — promise-based in-app confirm API.
 *
 * Services and components call `requestConfirm(...)` and await a boolean.
 * A self-registering dialog host (`ConfirmDialog.svelte`, mounted once in
 * `AppShell`) supplies the runner; until one is registered (or after it
 * unmounts) the prompt falls back to `window.confirm` so the action still
 * works in minimal mounts and tests.
 *
 * Single-flight: when a new request arrives while another is pending, the
 * pending one is resolved with `false` (cancelled) and the new request
 * takes over the dialog. Two confirms never render at once.
 */

export interface ConfirmRequest {
  /** Dialog title. Defaults to "Confirm". */
  title?: string;
  /** Body message (required). */
  message: string;
  /** Primary action label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Cancel action label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** When true, the primary button uses danger styling. */
  danger?: boolean;
  /**
   * Viewport rect of what the prompt is about (e.g. the rows being deleted).
   * When set, the prompt opens as a non-modal bubble beside it instead of a
   * centered dialog over a dimmed backdrop.
   */
  anchor?: ConfirmAnchor;
}

export interface ConfirmAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ConfirmPopoverPlacement {
  left: number;
  top: number;
  side: "right" | "left" | "below" | "above";
  /** Arrow offset along the edge facing the anchor, from the bubble's corner. */
  arrow: number;
}

const POPOVER_GAP_PX = 8;
const POPOVER_MARGIN_PX = 8;
const POPOVER_ARROW_INSET_PX = 14;

/**
 * Place a bubble of `size` next to `anchor` inside `viewport`: to the right
 * when it fits, then left, then below, then above; always clamped on screen.
 * Beside the anchor it lines up with the anchor's top so it sits next to the
 * first affected row; the arrow points at the middle of the visible anchor.
 */
export function placeConfirmPopover(
  anchor: ConfirmAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): ConfirmPopoverPlacement {
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, Math.max(min, max)));
  const maxLeft = viewport.width - size.width - POPOVER_MARGIN_PX;
  const maxTop = viewport.height - size.height - POPOVER_MARGIN_PX;
  const visibleTop = clamp(anchor.top, 0, viewport.height);
  const visibleBottom = clamp(anchor.bottom, visibleTop, viewport.height);
  const visibleLeft = clamp(anchor.left, 0, viewport.width);
  const visibleRight = clamp(anchor.right, visibleLeft, viewport.width);
  const arrowFor = (start: number, length: number, target: number) =>
    clamp(target - start, POPOVER_ARROW_INSET_PX, length - POPOVER_ARROW_INSET_PX);

  const besideTop = clamp(visibleTop - POPOVER_ARROW_INSET_PX + 4, POPOVER_MARGIN_PX, maxTop);
  const besideArrow = arrowFor(besideTop, size.height, Math.min(visibleTop + 12, (visibleTop + visibleBottom) / 2));
  if (visibleRight + POPOVER_GAP_PX + size.width + POPOVER_MARGIN_PX <= viewport.width) {
    return { side: "right", left: visibleRight + POPOVER_GAP_PX, top: besideTop, arrow: besideArrow };
  }
  if (visibleLeft - POPOVER_GAP_PX - size.width >= POPOVER_MARGIN_PX) {
    return { side: "left", left: visibleLeft - POPOVER_GAP_PX - size.width, top: besideTop, arrow: besideArrow };
  }
  const left = clamp(visibleLeft, POPOVER_MARGIN_PX, maxLeft);
  const arrow = arrowFor(left, size.width, (visibleLeft + visibleRight) / 2);
  if (visibleBottom + POPOVER_GAP_PX + size.height + POPOVER_MARGIN_PX <= viewport.height) {
    return { side: "below", left, top: visibleBottom + POPOVER_GAP_PX, arrow };
  }
  return { side: "above", left, top: clamp(visibleTop - POPOVER_GAP_PX - size.height, POPOVER_MARGIN_PX, maxTop), arrow };
}

type ConfirmRunner = (request: ConfirmRequest) => Promise<boolean>;

let runner: ConfirmRunner | null = null;

export function registerConfirmRunner(next: ConfirmRunner | null): void {
  runner = next;
}

/**
 * Resolve `true` when the user confirms, `false` when they cancel or dismiss.
 * Falls back to `window.confirm` when no dialog host is registered.
 */
export function requestConfirm(request: ConfirmRequest): Promise<boolean> {
  if (!runner) {
    return Promise.resolve(window.confirm(request.message));
  }
  return runner(request);
}

/**
 * Convenience wrapper for the common yes/no case with just a message.
 */
export function confirmDialog(message: string, danger = false): Promise<boolean> {
  return requestConfirm({ message, danger });
}
