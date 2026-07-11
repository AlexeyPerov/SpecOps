import { describe, expect, it } from "vitest";
import {
  activeIndexAfterResultsChange,
  clampActiveIndex,
  listNavigationActionFromKeyboard,
  moveActiveIndex,
} from "./listNavigation";

describe("clampActiveIndex", () => {
  it("returns -1 for empty lists", () => {
    expect(clampActiveIndex(0, 0)).toBe(-1);
    expect(clampActiveIndex(3, 0)).toBe(-1);
  });

  it("clamps into range", () => {
    expect(clampActiveIndex(-2, 5)).toBe(0);
    expect(clampActiveIndex(2, 5)).toBe(2);
    expect(clampActiveIndex(99, 5)).toBe(4);
  });
});

describe("moveActiveIndex", () => {
  it("returns -1 for empty lists for every action", () => {
    expect(moveActiveIndex(0, 0, { type: "next" })).toBe(-1);
    expect(moveActiveIndex(0, 0, { type: "previous" })).toBe(-1);
    expect(moveActiveIndex(0, 0, { type: "home" })).toBe(-1);
    expect(moveActiveIndex(0, 0, { type: "end" })).toBe(-1);
    expect(moveActiveIndex(0, 0, { type: "pageDown" })).toBe(-1);
  });

  it("moves with arrows and clamps at ends (no wrap)", () => {
    expect(moveActiveIndex(0, 5, { type: "next" })).toBe(1);
    expect(moveActiveIndex(4, 5, { type: "next" })).toBe(4);
    expect(moveActiveIndex(2, 5, { type: "previous" })).toBe(1);
    expect(moveActiveIndex(0, 5, { type: "previous" })).toBe(0);
  });

  it("supports Home / End", () => {
    expect(moveActiveIndex(3, 10, { type: "home" })).toBe(0);
    expect(moveActiveIndex(3, 10, { type: "end" })).toBe(9);
  });

  it("pages by default size and custom size", () => {
    expect(moveActiveIndex(0, 30, { type: "pageDown" })).toBe(10);
    expect(moveActiveIndex(15, 30, { type: "pageUp" })).toBe(5);
    expect(moveActiveIndex(0, 30, { type: "pageDown", pageSize: 3 })).toBe(3);
    expect(moveActiveIndex(2, 30, { type: "pageUp", pageSize: 3 })).toBe(0);
  });

  it("treats negative current as starting at 0", () => {
    expect(moveActiveIndex(-1, 5, { type: "next" })).toBe(1);
    expect(moveActiveIndex(-1, 5, { type: "home" })).toBe(0);
  });
});

describe("activeIndexAfterResultsChange", () => {
  it("clears selection when results become empty", () => {
    expect(activeIndexAfterResultsChange(2, 0)).toBe(-1);
  });

  it("selects first item when growing from empty selection", () => {
    expect(activeIndexAfterResultsChange(-1, 4)).toBe(0);
  });

  it("keeps index when still in range and clamps when not", () => {
    expect(activeIndexAfterResultsChange(2, 5)).toBe(2);
    expect(activeIndexAfterResultsChange(4, 3)).toBe(2);
  });
});

describe("listNavigationActionFromKeyboard", () => {
  it("maps navigation keys", () => {
    expect(listNavigationActionFromKeyboard({ key: "ArrowDown" })).toEqual({ type: "next" });
    expect(listNavigationActionFromKeyboard({ key: "ArrowUp" })).toEqual({ type: "previous" });
    expect(listNavigationActionFromKeyboard({ key: "PageDown" })).toEqual({ type: "pageDown" });
    expect(listNavigationActionFromKeyboard({ key: "PageUp" })).toEqual({ type: "pageUp" });
    expect(listNavigationActionFromKeyboard({ key: "Home" })).toEqual({ type: "home" });
    expect(listNavigationActionFromKeyboard({ key: "End" })).toEqual({ type: "end" });
  });

  it("ignores modified keys and unrelated keys", () => {
    expect(
      listNavigationActionFromKeyboard({ key: "ArrowDown", metaKey: true }),
    ).toBeNull();
    expect(listNavigationActionFromKeyboard({ key: "Enter" })).toBeNull();
    expect(listNavigationActionFromKeyboard({ key: "a" })).toBeNull();
  });
});
