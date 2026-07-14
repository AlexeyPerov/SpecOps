import { describe, expect, it } from "vitest";
import {
  crossPaneDropIndex,
  DRAG_THRESHOLD_PX,
  pointerDragDistance,
  shouldTearOffTab,
} from "./tabDragController";

describe("crossPaneDropIndex", () => {
  it("appends body drops after the destination pane tabs", () => {
    expect(crossPaneDropIndex(null, 3)).toBe(3);
    expect(crossPaneDropIndex(null, 0)).toBe(0);
  });

  it("keeps an explicit strip insertion index", () => {
    expect(crossPaneDropIndex(1, 3)).toBe(1);
  });
});

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
