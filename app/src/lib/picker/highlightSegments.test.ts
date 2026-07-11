import { describe, expect, it } from "vitest";
import { highlightSegments } from "./highlightSegments";

describe("highlightSegments", () => {
  it("returns the full text as a single non-match segment when ranges are empty", () => {
    expect(highlightSegments("hello.ts", [])).toEqual([{ text: "hello.ts", match: false }]);
  });

  it("marks a single contiguous range", () => {
    const segs = highlightSegments("config.ts", [{ start: 0, end: 6 }]);
    expect(segs).toEqual([
      { text: "config", match: true },
      { text: ".ts", match: false },
    ]);
  });

  it("marks a range in the middle of the text", () => {
    const segs = highlightSegments("app.config.ts", [{ start: 4, end: 10 }]);
    expect(segs).toEqual([
      { text: "app.", match: false },
      { text: "config", match: true },
      { text: ".ts", match: false },
    ]);
  });

  it("merges adjacent ranges into one segment", () => {
    const segs = highlightSegments("readme.md", [
      { start: 0, end: 3 },
      { start: 3, end: 6 },
    ]);
    expect(segs).toEqual([
      { text: "readme", match: true },
      { text: ".md", match: false },
    ]);
  });

  it("merges overlapping ranges", () => {
    const segs = highlightSegments("index.ts", [
      { start: 0, end: 3 },
      { start: 2, end: 5 },
    ]);
    expect(segs).toEqual([
      { text: "index", match: true },
      { text: ".ts", match: false },
    ]);
  });

  it("handles unsorted ranges by sorting internally", () => {
    const segs = highlightSegments("foo.bar.ts", [
      { start: 4, end: 7 },
      { start: 0, end: 3 },
    ]);
    expect(segs).toEqual([
      { text: "foo", match: true },
      { text: ".", match: false },
      { text: "bar", match: true },
      { text: ".ts", match: false },
    ]);
  });

  it("drops out-of-bounds ranges", () => {
    const segs = highlightSegments("ab", [
      { start: -1, end: 0 },
      { start: 5, end: 10 },
      { start: 0, end: 1 },
    ]);
    expect(segs).toEqual([
      { text: "a", match: true },
      { text: "b", match: false },
    ]);
  });

  it("drops ranges where start >= end", () => {
    const segs = highlightSegments("hello", [
      { start: 2, end: 2 },
      { start: 3, end: 1 },
      { start: 0, end: 2 },
    ]);
    expect(segs).toEqual([
      { text: "he", match: true },
      { text: "llo", match: false },
    ]);
  });

  it("preserves the full text across all segments", () => {
    const text = "src/components/Button.svelte";
    const ranges = [
      { start: 0, end: 3 },
      { start: 15, end: 21 },
    ];
    const segs = highlightSegments(text, ranges);
    expect(segs.map((s) => s.text).join("")).toBe(text);
  });
});
