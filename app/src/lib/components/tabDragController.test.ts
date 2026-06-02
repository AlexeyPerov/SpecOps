import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD_PX,
  pointerDragDistance,
  shouldTearOffTab,
} from "./tabDragController";

describe("pointerDragDistance", () => {
  it("uses 2D distance between pointer positions", () => {
    expect(pointerDragDistance(10, 10, 10, 6)).toBe(4);
    expect(pointerDragDistance(10, 10, 6, 10)).toBe(4);
    expect(pointerDragDistance(3, 4, 0, 0)).toBe(5);
  });
});

describe("shouldTearOffTab", () => {
  it("requires movement threshold when drag has not started", () => {
    expect(shouldTearOffTab(10, 20, 10, 10, false, DRAG_THRESHOLD_PX)).toBe(true);
    expect(shouldTearOffTab(10, 11, 10, 10, false, DRAG_THRESHOLD_PX)).toBe(false);
  });

  it("allows tear-off after drag threshold is met vertically", () => {
    expect(shouldTearOffTab(10, 20, 10, 10, true, DRAG_THRESHOLD_PX)).toBe(true);
  });
});
