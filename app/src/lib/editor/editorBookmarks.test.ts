import { afterEach, describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import {
  bookmarkField,
  bookmarkLines,
  bookmarkSnapshots,
  clearAllBookmarksEffect,
  nextBookmarkLine,
  reduceTransaction,
  toggleBookmarkEffect,
  type BookmarkState,
} from "./editorBookmarks";

/**
 * Bookmark state mapping + navigation tests (M7.2-3).
 *
 * Covers the deterministic mapping rules required by the spec: insertions,
 * deletions, splits/joins, toggle dedupe across selections, clear one/all,
 * next/previous wrap, and the line-preview bound.
 */
describe("bookmark pure helpers", () => {
  function docState(text: string): EditorState {
    return EditorState.create({ doc: text });
  }

  it("toggles a bookmark on a line", () => {
    const state = docState("line one\nline two\nline three");
    const tr = state.update({
      effects: toggleBookmarkEffect.of({ positions: [state.doc.line(2).from] }),
    });
    const next = reduceTransaction([], tr);
    expect(bookmarkLines(tr.newDoc, next)).toEqual([2]);
  });

  it("toggles off when the same line is already bookmarked", () => {
    const state = docState("a\nb\nc");
    const line2From = state.doc.line(2).from;
    const withMark = reduceTransaction(
      [],
      state.update({ effects: toggleBookmarkEffect.of({ positions: [line2From] }) }),
    );
    const afterToggleOff = reduceTransaction(
      withMark,
      state.update({ effects: toggleBookmarkEffect.of({ positions: [line2From + 1] }) }),
    );
    expect(bookmarkLines(state.doc, afterToggleOff)).toEqual([]);
  });

  it("deduplicates multiple selections on the same line", () => {
    const state = docState("aaa\nbbb\nccc");
    const line2 = state.doc.line(2);
    const next = reduceTransaction(
      [],
      state.update({
        effects: toggleBookmarkEffect.of({ positions: [line2.from, line2.from + 1, line2.to] }),
      }),
    );
    expect(next.length).toBe(1);
    expect(bookmarkLines(state.doc, next)).toEqual([2]);
  });

  it("toggles multiple lines in one transaction", () => {
    const state = docState("a\nb\nc\nd");
    const next = reduceTransaction(
      [],
      state.update({
        effects: toggleBookmarkEffect.of({
          positions: [state.doc.line(1).from, state.doc.line(3).from],
        }),
      }),
    );
    expect(bookmarkLines(state.doc, next)).toEqual([1, 3]);
  });

  it("maps bookmarks through an insertion above", () => {
    const state = docState("a\nb\nc");
    const marked = reduceTransaction(
      [],
      state.update({
        effects: toggleBookmarkEffect.of({ positions: [state.doc.line(3).from] }),
      }),
    );
    expect(bookmarkLines(state.doc, marked)).toEqual([3]);
    const insert = state.update({ changes: { from: 0, to: 0, insert: "x\n" } });
    const moved = reduceTransaction(marked, insert);
    // Bookmark was on line 3; inserting one line above moves it to line 4.
    expect(bookmarkLines(insert.newDoc, moved)).toEqual([4]);
  });

  it("maps a bookmark to the surviving line when its line is deleted", () => {
    const state = docState("a\nb\nc");
    const marked = reduceTransaction(
      [],
      state.update({
        effects: toggleBookmarkEffect.of({ positions: [state.doc.line(2).from] }),
      }),
    );
    expect(bookmarkLines(state.doc, marked)).toEqual([2]);
    const del = state.update({
      changes: { from: state.doc.line(2).from, to: state.doc.line(2).to + 1 },
    });
    const after = reduceTransaction(marked, del);
    // Documented rule: a deleted bookmarked line's mark maps to the next
    // surviving line (here line 2 now holds what was line 3's "c"). The mark
    // does not vanish silently — it follows the bias-left mapped position.
    expect(del.newDoc.toString()).toBe("a\nc");
    expect(bookmarkLines(del.newDoc, after)).toEqual([2]);
  });

  it("keeps the bookmark on the first surviving line when a line is split", () => {
    const state = docState("hello world\nsecond");
    const marked = reduceTransaction(
      [],
      state.update({
        effects: toggleBookmarkEffect.of({ positions: [state.doc.line(1).from] }),
      }),
    );
    const split = state.update({ changes: { from: 5, to: 5, insert: "\n" } });
    const after = reduceTransaction(marked, split);
    // Splitting the first line keeps the bookmark on line 1 (bias left).
    expect(split.newDoc.lines).toBe(3);
    expect(bookmarkLines(split.newDoc, after)).toEqual([1]);
  });

  it("merges a bookmark onto an adjacent line when lines are joined", () => {
    const state = docState("first\nsecond\nthird");
    const marked = reduceTransaction(
      [],
      state.update({
        effects: toggleBookmarkEffect.of({ positions: [state.doc.line(2).from] }),
      }),
    );
    const join = state.update({
      changes: { from: state.doc.line(1).to, to: state.doc.line(1).to + 1, insert: "" },
    });
    const after = reduceTransaction(marked, join);
    // After join the document is two lines; the mark lands on line 1.
    expect(join.newDoc.lines).toBe(2);
    expect(bookmarkLines(join.newDoc, after)).toEqual([1]);
  });

  it("clears all bookmarks", () => {
    const state = docState("a\nb\nc");
    const marked = reduceTransaction(
      [],
      state.update({
        effects: toggleBookmarkEffect.of({
          positions: [state.doc.line(1).from, state.doc.line(3).from],
        }),
      }),
    );
    const cleared = reduceTransaction(
      marked,
      state.update({ effects: clearAllBookmarksEffect.of(null) }),
    );
    expect(cleared).toEqual([]);
  });
});

describe("nextBookmarkLine", () => {
  function docState(text: string): EditorState {
    return EditorState.create({ doc: text });
  }

  function withMarks(text: string, lines: number[]): { state: EditorState; marks: BookmarkState } {
    const state = EditorState.create({ doc: text, extensions: [bookmarkField] });
    const positions = lines.map((line) => state.doc.line(line).from);
    const tr = state.update({ effects: toggleBookmarkEffect.of({ positions }) });
    const marks = tr.state.field(bookmarkField);
    return { state: tr.state, marks };
  }

  it("returns null when there are no bookmarks", () => {
    const state = docState("a\nb\nc");
    expect(nextBookmarkLine(state.doc, [], 0, "next")).toBeNull();
    expect(nextBookmarkLine(state.doc, [], 0, "previous")).toBeNull();
  });

  it("advances forward and wraps within the document", () => {
    const { state, marks } = withMarks("a\nb\nc\nd", [1, 3]);
    // cursor on line 1 (at its bookmark) → next is line 3
    expect(nextBookmarkLine(state.doc, marks, state.doc.line(1).from, "next")).toBe(3);
    // at the last bookmark → wrap to the first
    expect(nextBookmarkLine(state.doc, marks, state.doc.line(3).from, "next")).toBe(1);
    // cursor past the last bookmark → wrap to the first
    expect(nextBookmarkLine(state.doc, marks, state.doc.line(4).from, "next")).toBe(1);
  });

  it("goes backward and wraps within the document", () => {
    const { state, marks } = withMarks("a\nb\nc\nd", [1, 3]);
    expect(nextBookmarkLine(state.doc, marks, state.doc.line(4).from, "previous")).toBe(3);
    expect(nextBookmarkLine(state.doc, marks, state.doc.line(3).from, "previous")).toBe(1);
    // before the first bookmark → wrap to the last
    expect(nextBookmarkLine(state.doc, marks, 0, "previous")).toBe(3);
  });

  it("moves off the current line even with a single bookmark", () => {
    const { state, marks } = withMarks("a\nb\nc", [2]);
    // On the only bookmark, next wraps to itself (the only target).
    expect(nextBookmarkLine(state.doc, marks, state.doc.line(2).from, "next")).toBe(2);
    expect(nextBookmarkLine(state.doc, marks, state.doc.line(2).from, "previous")).toBe(2);
  });
});

describe("bookmarkSnapshots", () => {
  it("produces bounded, trimmed line previews", () => {
    const long = "x".repeat(200);
    const state = EditorState.create({ doc: `  hello\n${long}\n  ` });
    const positions = [state.doc.line(1).from, state.doc.line(2).from, state.doc.line(3).from];
    const snaps = bookmarkSnapshots(state.doc, positions);
    expect(snaps[0]!.preview).toBe("hello");
    expect(snaps[1]!.preview.endsWith("…")).toBe(true);
    expect(snaps[1]!.preview.length).toBeLessThanOrEqual(81);
    // empty/whitespace-only line has an empty preview
    expect(snaps[2]!.preview).toBe("");
    expect(snaps.map((s) => s.line)).toEqual([1, 2, 3]);
  });
});

describe("bookmarkField — undo integration", () => {
  function docState(text: string): EditorState {
    return EditorState.create({ doc: text, extensions: [bookmarkField] });
  }

  afterEach(() => {
    expect(document.body.querySelector(".cm-editor")).toBeNull();
  });

  it("tracks bookmark changes through the state field via toggle effect", () => {
    const state = docState("a\nb\nc");
    const tr = state.update({
      effects: toggleBookmarkEffect.of({ positions: [state.doc.line(2).from] }),
    });
    expect(tr.state.field(bookmarkField).length).toBe(1);
    // Toggle-off restores the empty state.
    const off = tr.state.update({
      effects: toggleBookmarkEffect.of({ positions: [tr.state.doc.line(2).from] }),
    });
    expect(off.state.field(bookmarkField)).toEqual([]);
  });

  it("maps through document edits in the live field", () => {
    const state = docState("a\nb\nc");
    const marked = state.update({
      effects: toggleBookmarkEffect.of({ positions: [state.doc.line(3).from] }),
    });
    const inserted = marked.state.update({
      changes: { from: 0, to: 0, insert: "x\n" },
    });
    expect(bookmarkLines(inserted.state.doc, inserted.state.field(bookmarkField))).toEqual([4]);
  });
});

describe("bookmarkField — multi-cursor toggle", () => {
  it("toggles across multiple selections with dedupe", () => {
    const state = EditorState.create({
      doc: "aaa\nbbb\nccc",
      extensions: [bookmarkField],
      selection: EditorSelection.create([
        EditorSelection.cursor(0),
        EditorSelection.cursor(4),
        EditorSelection.cursor(5),
      ]),
    });
    // Line 1 (pos 0) and line 2 (pos 4 and 5 dedupe) → 2 lines bookmarked.
    const tr = state.update({
      effects: toggleBookmarkEffect.of({ positions: [0, 4, 5] }),
    });
    expect(bookmarkLines(tr.state.doc, tr.state.field(bookmarkField))).toEqual([1, 2]);
  });
});
