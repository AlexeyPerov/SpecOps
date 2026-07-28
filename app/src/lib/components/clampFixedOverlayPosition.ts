/**
 * Clamp a fixed-position overlay's top-left corner so its box stays inside the
 * viewport (with a small margin). Used by context menus opened at raw
 * client coordinates.
 */
export function clampFixedOverlayPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  options?: {
    margin?: number;
    viewportWidth?: number;
    viewportHeight?: number;
  },
): { x: number; y: number } {
  const margin = options?.margin ?? 4;
  const viewportWidth = options?.viewportWidth ?? window.innerWidth;
  const viewportHeight = options?.viewportHeight ?? window.innerHeight;
  const maxX = Math.max(margin, viewportWidth - width - margin);
  const maxY = Math.max(margin, viewportHeight - height - margin);
  return {
    x: Math.min(Math.max(x, margin), maxX),
    y: Math.min(Math.max(y, margin), maxY),
  };
}
