import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  selectAllOccurrencesOp,
  selectNextOccurrenceOp,
  skipOccurrenceOp,
  undoOccurrenceOp,
} from "./editorSelectionOps";

function mountView(
  doc: string,
  ranges: Array<{ from: number; to?: number }>,
): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create(
      ranges.map((r) =>
        r.to === undefined || r.to === r.from
          ? EditorSelection.cursor(r.from)
          : EditorSelection.range(r.from, r.to),
      ),
    ),
    extensions: [
      EditorState.allowMultipleSelections.of(true),
    ],
  });
  return new EditorView({ state, parent });
}

const views: EditorView[] = [];

function createView(
  doc: string,
  ranges: Array<{ from: number; to?: number }>,
): EditorView {
  const view = mountView(doc, ranges);
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views) {
    view.destroy();
  }
  views.length = 0;
});

describe("selectNextOccurrenceOp", () => {
  it("seeds from the word at an empty cursor", () => {
    // "foo bar foo" — cursor inside first "foo"
    const view = createView("foo bar foo", [{ from: 1 }]);
    // First call expands the empty cursor to the word "foo".
    const first = selectNextOccurrenceOp(view);
    expect(first.ok).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(1);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(3);
    // Second call finds and adds the next "foo".
    const second = selectNextOccurrenceOp(view);
    expect(second.ok).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(2);
    const froms = view.state.selection.ranges.map((r) => r.from).sort((a, b) => a - b);
    expect(froms).toEqual([0, 8]);
  });

  it("adds the next occurrence of a non-empty selection", () => {
    const view = createView("foo bar foo", [{ from: 0, to: 3 }]);
    const result = selectNextOccurrenceOp(view);
    expect(result.ok).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(2);
    expect(view.state.selection.ranges[1]!.from).toBe(8);
  });

  it("wraps around the document once", () => {
    const view = createView("foo bar foo", [{ from: 8, to: 11 }]);
    const result = selectNextOccurrenceOp(view);
    expect(result.ok).toBe(true);
    // Wrapped back to position 0; ranges are sorted in document order so the
    // new range at 0 is ranges[0] and the original at 8 is ranges[1].
    expect(view.state.selection.ranges).toHaveLength(2);
    const froms = view.state.selection.ranges.map((r) => r.from).sort((a, b) => a - b);
    expect(froms).toEqual([0, 8]);
  });

  it("returns false when no more occurrences exist", () => {
    const view = createView("foo bar", [{ from: 0, to: 3 }]);
    const result = selectNextOccurrenceOp(view);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("No more occurrences");
  });

  it("avoids duplicate overlapping ranges", () => {
    // "foo foo foo" — select first, then next, then next should not overlap.
    const view = createView("foo foo foo", [{ from: 0, to: 3 }]);
    selectNextOccurrenceOp(view);
    expect(view.state.selection.ranges).toHaveLength(2);
    selectNextOccurrenceOp(view);
    expect(view.state.selection.ranges).toHaveLength(3);
    const froms = view.state.selection.ranges.map((r) => r.from).sort((a, b) => a - b);
    expect(froms).toEqual([0, 4, 8]);
  });

  it("returns false when selections differ", () => {
    // Two non-empty selections with different text.
    const view = createView("foo bar", [
      { from: 0, to: 3 },
      { from: 4, to: 7 },
    ]);
    const result = selectNextOccurrenceOp(view);
    expect(result.ok).toBe(false);
  });
});

describe("selectAllOccurrencesOp", () => {
  it("selects all instances of the selected text", () => {
    const view = createView("foo bar foo baz foo", [{ from: 0, to: 3 }]);
    const result = selectAllOccurrencesOp(view);
    expect(result.ok).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(3);
    const froms = view.state.selection.ranges.map((r) => r.from).sort((a, b) => a - b);
    expect(froms).toEqual([0, 8, 16]);
  });

  it("returns false for empty selection", () => {
    const view = createView("foo bar", [{ from: 0 }]);
    const result = selectAllOccurrencesOp(view);
    expect(result.ok).toBe(false);
  });

  it("selects a single instance", () => {
    // selectSelectionMatches selects the single match; ok is true.
    const view = createView("foo bar", [{ from: 0, to: 3 }]);
    const result = selectAllOccurrencesOp(view);
    expect(result.ok).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(1);
  });
});

describe("skipOccurrenceOp", () => {
  it("advances the main selection to the next match without adding a range", () => {
    // Start with one selection on first "foo".
    const view = createView("foo bar foo", [{ from: 0, to: 3 }]);
    const result = skipOccurrenceOp(view);
    expect(result.ok).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(1);
    expect(view.state.selection.main.from).toBe(8);
  });

  it("advances main while keeping secondary ranges", () => {
    // Three occurrences; select two, skip moves main to the third.
    const view = createView("foo bar foo baz foo", [
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
    const result = skipOccurrenceOp(view);
    expect(result.ok).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(2);
    // Main should now be at position 16 (the third "foo").
    expect(view.state.selection.main.from).toBe(16);
  });

  it("returns false when there is no further match", () => {
    const view = createView("foo bar", [{ from: 0, to: 3 }]);
    const result = skipOccurrenceOp(view);
    expect(result.ok).toBe(false);
  });

  it("returns false for empty selection", () => {
    const view = createView("foo bar", [{ from: 0 }]);
    const result = skipOccurrenceOp(view);
    expect(result.ok).toBe(false);
  });
});

describe("undoOccurrenceOp", () => {
  it("removes the last added range", () => {
    // Two selections on "foo".
    const view = createView("foo bar foo", [
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
    const result = undoOccurrenceOp(view);
    expect(result.ok).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(1);
  });

  it("returns false when only one selection remains", () => {
    const view = createView("foo bar", [{ from: 0, to: 3 }]);
    const result = undoOccurrenceOp(view);
    expect(result.ok).toBe(false);
  });

  it("removes the most recently added of three ranges", () => {
    const view = createView("foo foo foo", [
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ]);
    const result = undoOccurrenceOp(view);
    expect(result.ok).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(2);
    // The last range (position 8) should be removed.
    const froms = view.state.selection.ranges.map((r) => r.from).sort((a, b) => a - b);
    expect(froms).toEqual([0, 4]);
  });
});
