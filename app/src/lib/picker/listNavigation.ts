/**
 * Pure active-index helpers for searchable list navigation.
 * No DOM — callers feed length and apply the returned index.
 */

export const DEFAULT_LIST_PAGE_SIZE = 10;

export type ListNavigationAction =
  | { type: "next" }
  | { type: "previous" }
  | { type: "pageDown"; pageSize?: number }
  | { type: "pageUp"; pageSize?: number }
  | { type: "home" }
  | { type: "end" };

/**
 * Clamp an active index into `[0, length)`. Empty lists yield `-1`.
 */
export function clampActiveIndex(index: number, length: number): number {
  if (length <= 0) {
    return -1;
  }
  if (!Number.isFinite(index)) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, Math.trunc(index)));
}

/**
 * Move the active index for arrow / paging / Home / End keys.
 * Does not wrap; clamps at ends. Empty lists stay at `-1`.
 */
export function moveActiveIndex(
  current: number,
  length: number,
  action: ListNavigationAction,
): number {
  if (length <= 0) {
    return -1;
  }

  const pageSize = Math.max(
    1,
    action.type === "pageDown" || action.type === "pageUp"
      ? (action.pageSize ?? DEFAULT_LIST_PAGE_SIZE)
      : DEFAULT_LIST_PAGE_SIZE,
  );

  const base = clampActiveIndex(current < 0 ? 0 : current, length);

  switch (action.type) {
    case "next":
      return clampActiveIndex(base + 1, length);
    case "previous":
      return clampActiveIndex(base - 1, length);
    case "pageDown":
      return clampActiveIndex(base + pageSize, length);
    case "pageUp":
      return clampActiveIndex(base - pageSize, length);
    case "home":
      return 0;
    case "end":
      return length - 1;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/**
 * After filtered results change, keep the selection stable when possible.
 * - Empty → `-1`
 * - Previous index still in range → keep
 * - Otherwise clamp to last item (or `0` when growing from empty)
 */
export function activeIndexAfterResultsChange(
  previousIndex: number,
  nextLength: number,
): number {
  if (nextLength <= 0) {
    return -1;
  }
  if (previousIndex < 0) {
    return 0;
  }
  return clampActiveIndex(previousIndex, nextLength);
}

/**
 * Map a keyboard event to a list navigation action, or null when unhandled.
 * Does not call preventDefault — the caller decides.
 */
export function listNavigationActionFromKeyboard(
  event: Pick<KeyboardEvent, "key"> &
    Partial<Pick<KeyboardEvent, "altKey" | "metaKey" | "ctrlKey">>,
): ListNavigationAction | null {
  if (event.altKey || event.metaKey || event.ctrlKey) {
    return null;
  }
  switch (event.key) {
    case "ArrowDown":
      return { type: "next" };
    case "ArrowUp":
      return { type: "previous" };
    case "PageDown":
      return { type: "pageDown" };
    case "PageUp":
      return { type: "pageUp" };
    case "Home":
      return { type: "home" };
    case "End":
      return { type: "end" };
    default:
      return null;
  }
}
