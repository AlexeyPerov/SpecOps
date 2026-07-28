import { afterEach, describe, expect, it, vi } from "vitest";
import { startPointerDrag } from "./pointerDrag";

function pointerEvent(
  type: string,
  pointerId: number,
  extras: Partial<PointerEvent> = {},
): PointerEvent {
  return new PointerEvent(type, { pointerId, bubbles: true, ...extras });
}

describe("startPointerDrag", () => {
  afterEach(() => {
    // Ensure no leaked listeners between tests.
    window.dispatchEvent(pointerEvent("pointerup", 1));
  });

  it("forwards move events for the captured pointer id", () => {
    const onMove = vi.fn();
    const teardown = startPointerDrag({
      pointerId: 7,
      onMove,
    });

    window.dispatchEvent(pointerEvent("pointermove", 7, { clientX: 12 }));
    window.dispatchEvent(pointerEvent("pointermove", 3, { clientX: 99 }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0].clientX).toBe(12);

    teardown();
  });

  it("runs onEnd once on pointerup and detaches listeners", () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    startPointerDrag({ pointerId: 1, onMove, onEnd });

    window.dispatchEvent(pointerEvent("pointerup", 1));
    window.dispatchEvent(pointerEvent("pointermove", 1));
    window.dispatchEvent(pointerEvent("pointerup", 1));

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("teardown from destroy does not call onEnd", () => {
    const onEnd = vi.fn();
    const teardown = startPointerDrag({
      pointerId: 2,
      onMove: () => {},
      onEnd,
    });

    teardown();
    window.dispatchEvent(pointerEvent("pointerup", 2));
    expect(onEnd).not.toHaveBeenCalled();
  });
});
