import { describe, expect, it } from "vitest";
import {
  buildReplaceAllChanges,
  countReplaceAllMatches,
  findNextMatchIndex,
  findPreviousMatchIndex,
  normalizeForSearch,
  replaceSelectionText,
  selectionMatchesQuery,
} from "./editorSearchOps";

describe("editorSearchOps", () => {
  const doc = "Alpha alpha\nBETA beta";

  it("normalizes search text when case sensitivity is off", () => {
    expect(normalizeForSearch("Alpha", false)).toBe("alpha");
    expect(normalizeForSearch("Alpha", true)).toBe("Alpha");
  });

  it("finds the next match from the cursor and wraps to the start", () => {
    expect(findNextMatchIndex(doc, "alpha", false, 0)).toBe(0);
    expect(findNextMatchIndex(doc, "alpha", false, 1)).toBe(6);
    expect(findNextMatchIndex(doc, "alpha", false, 12)).toBe(0);
    expect(findNextMatchIndex(doc, "missing", false, 0)).toBeNull();
  });

  it("finds the previous match from the cursor and wraps to the end", () => {
    expect(findPreviousMatchIndex(doc, "alpha", false, 6)).toBe(0);
    expect(findPreviousMatchIndex(doc, "alpha", false, 0)).toBe(6);
    expect(findPreviousMatchIndex(doc, "BETA", true, 20)).toBe(12);
  });

  it("matches the current selection against the query", () => {
    expect(selectionMatchesQuery("alpha", "Alpha", false)).toBe(true);
    expect(selectionMatchesQuery("alpha", "Alpha", true)).toBe(false);
  });

  it("replaces the selected range and reports the new selection", () => {
    const replaced = replaceSelectionText("foo bar", 4, 7, "baz");
    expect(replaced).toEqual({ text: "foo baz", from: 4, to: 7 });
  });

  it("counts and builds replace-all changes with case-insensitive matching", () => {
    expect(countReplaceAllMatches(doc, "alpha", false)).toBe(2);
    const { changes, count } = buildReplaceAllChanges(doc, "alpha", "omega", false);
    expect(count).toBe(2);
    expect(changes).toEqual([
      { from: 0, to: 5, insert: "omega" },
      { from: 6, to: 11, insert: "omega" },
    ]);
  });
});
