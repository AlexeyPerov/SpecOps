/**
 * Anchored prompts: a prompt about something on screen (rows being deleted,
 * the button that asked for a name) opens as a non-modal bubble beside it
 * instead of a centered dialog over a dimmed backdrop. See `DialogShell`'s
 * `anchor` prop.
 */

export interface PromptAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AnchoredPlacement {
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
export function placeAnchoredPopover(
  anchor: PromptAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): AnchoredPlacement {
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

/** Viewport rect of `element`, or undefined when it is missing or not laid out. */
export function anchorFromElement(element: Element | null | undefined): PromptAnchor | undefined {
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return undefined;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/** Anchor at the element an event was dispatched on (e.g. the clicked button). */
export function anchorFromEvent(event: Event | null | undefined): PromptAnchor | undefined {
  const target = event?.currentTarget ?? event?.target;
  return target instanceof Element ? anchorFromElement(target) : undefined;
}

/** Zero-size anchor at a viewport point, e.g. where a context menu was opened. */
export function anchorFromPoint(x: number, y: number): PromptAnchor {
  return { left: x, top: y, right: x, bottom: y };
}
