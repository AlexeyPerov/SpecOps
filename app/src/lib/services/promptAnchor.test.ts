import { describe, expect, it } from "vitest";
import { anchorFromPoint, placeAnchoredPopover } from "./promptAnchor";

describe("placeAnchoredPopover", () => {
  const viewport = { width: 1200, height: 800 };
  const size = { width: 280, height: 120 };

  it("opens to the right of the anchor, level with its first row", () => {
    const placement = placeAnchoredPopover({ left: 0, top: 200, right: 300, bottom: 266 }, size, viewport);
    expect(placement.side).toBe("right");
    expect(placement.left).toBe(308);
    expect(placement.top).toBeLessThanOrEqual(200);
    expect(placement.top + placement.arrow).toBeGreaterThan(200);
    expect(placement.top + placement.arrow).toBeLessThan(266);
  });

  it("falls back to the left side when the right side has no room", () => {
    const placement = placeAnchoredPopover({ left: 900, top: 200, right: 1100, bottom: 222 }, size, viewport);
    expect(placement.side).toBe("left");
    expect(placement.left).toBe(900 - 8 - size.width);
  });

  it("goes below a full-width anchor and stays on screen", () => {
    const placement = placeAnchoredPopover({ left: 0, top: 100, right: 1200, bottom: 122 }, size, viewport);
    expect(placement.side).toBe("below");
    expect(placement.left).toBeGreaterThanOrEqual(8);
    expect(placement.left + size.width).toBeLessThanOrEqual(viewport.width - 8);
  });

  it("clamps the bubble inside the viewport near the bottom edge", () => {
    const placement = placeAnchoredPopover({ left: 0, top: 790, right: 300, bottom: 812 }, size, viewport);
    expect(placement.side).toBe("right");
    expect(placement.top + size.height).toBeLessThanOrEqual(viewport.height - 8);
  });
});

describe("anchorFromPoint", () => {
  it("is a zero-size rect at the point", () => {
    expect(anchorFromPoint(10, 20)).toEqual({ left: 10, top: 20, right: 10, bottom: 20 });
  });
});
