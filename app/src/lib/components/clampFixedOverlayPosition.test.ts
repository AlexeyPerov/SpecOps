import { describe, expect, it } from "vitest";
import { clampFixedOverlayPosition } from "./clampFixedOverlayPosition";

describe("clampFixedOverlayPosition", () => {
  const viewport = { viewportWidth: 800, viewportHeight: 600 };

  it("keeps an in-bounds position unchanged", () => {
    expect(clampFixedOverlayPosition(100, 80, 180, 240, viewport)).toEqual({
      x: 100,
      y: 80,
    });
  });

  it("clamps near the bottom-right edge", () => {
    expect(clampFixedOverlayPosition(780, 560, 180, 240, viewport)).toEqual({
      x: 616,
      y: 356,
    });
  });

  it("clamps negative coords to the margin", () => {
    expect(clampFixedOverlayPosition(-20, -10, 100, 100, viewport)).toEqual({
      x: 4,
      y: 4,
    });
  });

  it("honors a custom margin", () => {
    expect(
      clampFixedOverlayPosition(790, 590, 50, 50, { ...viewport, margin: 8 }),
    ).toEqual({
      x: 742,
      y: 542,
    });
  });

  it("does not go below the margin when the menu is larger than the viewport", () => {
    expect(clampFixedOverlayPosition(10, 10, 900, 700, viewport)).toEqual({
      x: 4,
      y: 4,
    });
  });
});
