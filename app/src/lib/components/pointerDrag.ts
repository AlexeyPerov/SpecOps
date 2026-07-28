/**
 * Attach window-level pointermove / pointerup / pointercancel listeners for a
 * drag or resize gesture. Returns a teardown that detaches the listeners (and
 * releases pointer capture). Call that teardown from `onDestroy` so an unmount
 * mid-drag cannot leave handlers writing into a destroyed component.
 *
 * `onEnd` runs only for a real pointerup/pointercancel — not when teardown is
 * invoked from `onDestroy`.
 */
export function startPointerDrag(options: {
  pointerId: number;
  target?: HTMLElement | null;
  onMove: (event: PointerEvent) => void;
  onEnd?: () => void;
}): () => void {
  const { pointerId, target, onMove, onEnd } = options;
  let cleaned = false;

  const handleMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) {
      return;
    }
    onMove(event);
  };

  const handleEnd = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) {
      return;
    }
    teardown();
    onEnd?.();
  };

  function teardown(): void {
    if (cleaned) {
      return;
    }
    cleaned = true;
    if (target?.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleEnd);
    window.removeEventListener("pointercancel", handleEnd);
  }

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleEnd);
  window.addEventListener("pointercancel", handleEnd);

  return teardown;
}
