/** Scrollable range for an element (vertical). */
export function maxScrollTop(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight)
}

/** Normalized scroll position in [0, 1]. */
export function getScrollFraction(el: HTMLElement): number {
  const max = maxScrollTop(el)
  if (max <= 0) return 0
  return Math.min(1, Math.max(0, el.scrollTop / max))
}

/** Apply scroll from a fraction in [0, 1]. */
export function setScrollFraction(el: HTMLElement, fraction: number): void {
  const f = Math.min(1, Math.max(0, fraction))
  const max = maxScrollTop(el)
  el.scrollTop = max <= 0 ? 0 : f * max
}
