import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  buildReplaceAllChanges,
  countReplaceAllMatches,
  editorReplaceAll,
  editorReplaceCurrent,
  findNextMatchIndex,
  findNextRange,
  findPreviousMatchIndex,
  normalizeForSearch,
  replaceSelectionText,
  selectionMatchesQuery,
} from "./editorSearchOps";
import { createSearchQuery } from "./searchQuery";

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

describe("findNextRange wrap", () => {
  it("wraps to the sole full-document match when the cursor is at the end", () => {
    const text = Text.of(["abc"]);
    const query = createSearchQuery({ text: "abc", caseSensitive: true });
    expect(findNextRange(text, query, 3)).toEqual({ from: 0, to: 3 });
  });
});

describe("editorReplaceCurrent regex captures", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("expands lookbehind captures using document context, not the isolated slice", () => {
    view = new EditorView({
      doc: "x42",
      parent: document.body,
    });
    view.dispatch({
      selection: EditorSelection.range(1, 3),
    });
    const query = createSearchQuery({
      text: "(?<=x)(\\d+)",
      replacement: "n$1",
      regexp: true,
      caseSensitive: true,
    });
    expect(editorReplaceCurrent(view, query)).toBe(true);
    expect(view.state.doc.toString()).toBe("xn42");
  });

  it("rejects a selection that is not an exact match without scanning for replace", () => {
    view = new EditorView({
      doc: "alpha alpha alpha",
      parent: document.body,
    });
    view.dispatch({
      selection: EditorSelection.range(0, 3), // "alp", not a full match
    });
    const query = createSearchQuery({
      text: "alpha",
      replacement: "omega",
      caseSensitive: true,
    });
    expect(editorReplaceCurrent(view, query)).toBe(false);
    expect(view.state.doc.toString()).toBe("alpha alpha alpha");
  });
});

describe("editorReplaceAll", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("replaces using the live Text document (no string rebuild)", () => {
    view = new EditorView({
      doc: "alpha\nbeta alpha",
      parent: document.body,
    });
    const query = createSearchQuery({
      text: "alpha",
      replacement: "omega",
      caseSensitive: true,
    });
    expect(editorReplaceAll(view, query)).toBe(2);
    expect(view.state.doc.toString()).toBe("omega\nbeta omega");
  });
});
