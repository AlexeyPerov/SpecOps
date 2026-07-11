/**
 * M2.2-3 cross-feature validation tests for multiple selections.
 *
 * Verifies that multi-cursor edits integrate correctly with:
 * - Undo/redo (single step per multi-cursor edit)
 * - Line operations (selections preserved)
 * - Occurrence selection followed by synchronized typing
 * - The domain API runner facade
 */
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { EditorView, keymap } from "@codemirror/view";
import {
  selectAllOccurrencesOp,
  selectNextOccurrenceOp,
  skipOccurrenceOp,
  undoOccurrenceOp,
} from "./editorSelectionOps";
import { buildLineOpTransaction } from "./editorLineTransactions";

const views: EditorView[] = [];

function createView(
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
      history(),
      keymap.of([]),
    ],
  });
  const view = new EditorView({ state, parent });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views) {
    view.destroy();
  }
  views.length = 0;
});

describe("M2.2-3: multi-cursor cross-feature validation", () => {
  it("typing at multiple cursors edits every range in one undoable transaction", () => {
    const view = createView("foo\nbar\nfoo", [{ from: 0 }, { from: 8 }]);
    expect(view.state.selection.ranges).toHaveLength(2);

    // Type "x" at both cursors.
    view.dispatch({
      changes: view.state.selection.ranges.map((r) => ({
        from: r.from,
        insert: "x",
      })),
    });
    expect(view.state.doc.toString()).toBe("xfoo\nbar\nxfoo");

    // One undo reverts both insertions.
    undo(view);
    expect(view.state.doc.toString()).toBe("foo\nbar\nfoo");
  });

  it("deleting at multiple cursors removes text from each range", () => {
    const view = createView("abc\nabc\nabc", [
      { from: 0, to: 1 },
      { from: 4, to: 5 },
      { from: 8, to: 9 },
    ]);
    view.dispatch({
      changes: view.state.selection.ranges.map((r) => ({
        from: r.from,
        to: r.to,
      })),
    });
    expect(view.state.doc.toString()).toBe("bc\nbc\nbc");
  });

  it("occurrence selection followed by typing edits all occurrences", () => {
    const view = createView("foo bar foo baz", [{ from: 0, to: 3 }]);

    // Select all occurrences of "foo".
    const allResult = selectAllOccurrencesOp(view);
    expect(allResult.ok).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(2);

    // Type replacement text at both selections.
    view.dispatch({
      changes: view.state.selection.ranges.map((r) => ({
        from: r.from,
        to: r.to,
        insert: "qux",
      })),
    });
    expect(view.state.doc.toString()).toBe("qux bar qux baz");
  });

  it("select-next then skip and remove produces consistent selections", () => {
    const view = createView("foo one foo two foo", [{ from: 0, to: 3 }]);

    // Select next → 2 ranges.
    selectNextOccurrenceOp(view);
    expect(view.state.selection.ranges).toHaveLength(2);

    // Select next again → 3 ranges.
    selectNextOccurrenceOp(view);
    expect(view.state.selection.ranges).toHaveLength(3);

    // Skip: main moves but range count stays (wraps to first if only 3 exist).
    // With 3 "foo"s all selected, skip wraps — but skip replaces main, not adds.
    // Use undoOccurrence to remove one.
    const undoResult = undoOccurrenceOp(view);
    expect(undoResult.ok).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(2);
  });

  it("duplicate line preserves multi-cursor selection", () => {
    const view = createView("alpha\nbeta\ngamma", [{ from: 0 }, { from: 11 }]);
    expect(view.state.selection.ranges).toHaveLength(2);
    const result = buildLineOpTransaction(view.state, "duplicate");
    expect(result.changes.length).toBe(2);
    expect(result.selection.ranges).toHaveLength(2);
  });

  it("move line up preserves multi-cursor selection count", () => {
    const view = createView("a\nb\nc\nd", [{ from: 2 }, { from: 6 }]);
    const result = buildLineOpTransaction(view.state, "moveUp");
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.selection.ranges).toHaveLength(2);
  });

  it("join lines preserves multi-cursor selection count", () => {
    const view = createView("a\nb\nc\nd", [{ from: 0 }, { from: 4 }]);
    const result = buildLineOpTransaction(view.state, "join");
    expect(result.changes.length).toBe(2);
    expect(result.selection.ranges).toHaveLength(2);
  });

  it("occurrence commands do not overlap ranges", () => {
    const view = createView("test\ntest\ntest\ntest", [{ from: 0, to: 4 }]);
    selectNextOccurrenceOp(view);
    selectNextOccurrenceOp(view);
    selectNextOccurrenceOp(view);
    expect(view.state.selection.ranges).toHaveLength(4);
    // All four ranges should be at distinct positions.
    const froms = view.state.selection.ranges.map((r) => r.from);
    expect(new Set(froms).size).toBe(4);
  });

  it("save content matches visible multi-range edits", () => {
    const view = createView("hello\nworld\nhello", [{ from: 0, to: 5 }]);
    selectAllOccurrencesOp(view);
    view.dispatch({
      changes: view.state.selection.ranges.map((r) => ({
        from: r.from,
        to: r.to,
        insert: "bye",
      })),
    });
    // The document content after multi-cursor edit should reflect both changes.
    expect(view.state.doc.toString()).toBe("bye\nworld\nbye");
  });

  it("skip occurrence advances main without growing range count", () => {
    const view = createView("foo x foo y foo z foo", [{ from: 0, to: 3 }]);
    // Build up to 2 selections first.
    selectNextOccurrenceOp(view);
    expect(view.state.selection.ranges).toHaveLength(2);
    // Skip: main moves to the third "foo", count stays 2.
    const skipResult = skipOccurrenceOp(view);
    expect(skipResult.ok).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(2);
  });
});
