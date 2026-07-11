import { describe, expect, it } from "vitest";
import {
  ChangeSet,
  EditorSelection,
  EditorState,
  Text,
} from "@codemirror/state";
import {
  buildLineOpTransaction,
  lineBlockForRange,
  mergeLineBlocks,
} from "./editorLineTransactions";
import {
  duplicateLineText,
  joinLinesText,
  moveLineDown,
  moveLineUp,
} from "./editorLineOps";

function stateWithDoc(
  doc: string,
  ranges: Array<{ from: number; to?: number }>,
  allowMultiple = false,
): EditorState {
  const selection = EditorSelection.create(
    ranges.map((r) =>
      r.to === undefined || r.to === r.from
        ? EditorSelection.cursor(r.from)
        : EditorSelection.range(r.from, r.to),
    ),
  );
  return EditorState.create({
    doc,
    selection,
    extensions: allowMultiple ? [EditorState.allowMultipleSelections.of(true)] : [],
  });
}

function applyOp(state: EditorState, kind: Parameters<typeof buildLineOpTransaction>[1]) {
  const op = buildLineOpTransaction(state, kind);
  if (op.changes.length === 0) {
    return { doc: state.doc.toString(), selection: state.selection, message: op.message };
  }
  const changeSet = ChangeSet.of(op.changes, state.doc.length);
  return {
    doc: changeSet.apply(state.doc).toString(),
    selection: op.selection,
    message: op.message,
    changeCount: op.changes.length,
  };
}

describe("editorLineTransactions", () => {
  it("merges overlapping and adjacent line blocks", () => {
    expect(
      mergeLineBlocks([
        { from: 0, to: 5 },
        { from: 0, to: 5 },
        { from: 6, to: 10 },
        { from: 20, to: 25 },
      ]),
    ).toEqual([
      { from: 0, to: 10 },
      { from: 20, to: 25 },
    ]);
  });

  it("computes line blocks matching pure lineRange spans", () => {
    const doc = Text.of(["alpha", "beta", "gamma"]);
    const range = EditorSelection.cursor(7);
    expect(lineBlockForRange(doc, range)).toEqual({ from: 6, to: 10 });
  });

  it("matches single-selection pure move/duplicate/join transforms", () => {
    const text = "first\nsecond\nthird";

    const upState = stateWithDoc(text, [{ from: 8 }]);
    const up = applyOp(upState, "moveUp");
    const upPure = moveLineUp(text, 8, 8);
    expect(up.doc).toBe(upPure.text);
    expect(up.message).toBe(upPure.message);
    expect(up.selection.main.from).toBe(upPure.from);

    const downState = stateWithDoc(up.doc, [{ from: 0 }]);
    const down = applyOp(downState, "moveDown");
    const downPure = moveLineDown(up.doc, 0, 0);
    expect(down.doc).toBe(downPure.text);

    const dupState = stateWithDoc("alpha\nbeta", [{ from: 6 }]);
    const dup = applyOp(dupState, "duplicate");
    const dupPure = duplicateLineText("alpha\nbeta", 6, 6);
    expect(dup.doc).toBe(dupPure.text);

    const joinState = stateWithDoc("alpha\nbeta\ngamma", [{ from: 0 }]);
    const join = applyOp(joinState, "join");
    const joinPure = joinLinesText("alpha\nbeta\ngamma", 0, 0);
    expect(join.doc).toBe(joinPure.text);
  });

  it("preserves secondary selections when moving lines", () => {
    const text = "a\nb\nc\nd";
    // cursors on "b" (pos 2) and "d" (pos 6)
    const state = stateWithDoc(text, [{ from: 2 }, { from: 6 }], true);
    expect(state.selection.ranges).toHaveLength(2);

    const result = applyOp(state, "moveUp");
    expect(result.doc).toBe("b\na\nd\nc");
    expect(result.selection.ranges).toHaveLength(2);
    // Cursors stay on the moved lines ("b" at 0, "d" at 4).
    expect(result.selection.ranges.map((r) => r.from).sort((a, b) => a - b)).toEqual([
      0, 4,
    ]);
  });

  it("deduplicates two cursors on the same line for duplicate", () => {
    const text = "alpha\nbeta\ngamma";
    // two cursors on "beta"
    const state = stateWithDoc(text, [{ from: 6 }, { from: 8 }], true);
    const result = applyOp(state, "duplicate");
    expect(result.doc).toBe("alpha\nbeta\nbeta\ngamma");
    expect(result.changeCount).toBe(1);
    expect(result.selection.ranges).toHaveLength(2);
  });

  it("does not replace the full document for a one-line edit", () => {
    const text = "line1\nline2\nline3\nline4\nline5";
    const state = stateWithDoc(text, [{ from: 6 }]);
    const op = buildLineOpTransaction(state, "moveUp");
    expect(op.changes).toHaveLength(1);
    const change = op.changes[0] as { from: number; to: number; insert: string };
    // Only the swapped pair region, not 0..doc.length.
    expect(change.from).toBe(0);
    expect(change.to).toBeLessThan(text.length);
    expect(change.to).toBe(11); // "line1\nline2"
  });

  it("reports boundary messages without emitting changes", () => {
    const state = stateWithDoc("only\nline", [{ from: 0 }]);
    const op = buildLineOpTransaction(state, "moveUp");
    expect(op.changes).toHaveLength(0);
    expect(op.message).toBe("Already at first line");
  });
});
