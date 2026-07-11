/**
 * Occurrence-selection operations over a live CodeMirror view.
 *
 * Uses the `@codemirror/search` cursor and CodeMirror's `selectNextOccurrence`
 * for the core "select next" / "select all" flows, then adds SpecOps-native
 * "skip" and "remove last" commands that CodeMirror does not ship.
 *
 * All commands operate on the active pane view only and emit a single undoable
 * transaction. Wrap/no-more-match behavior is deterministic: select-next wraps
 * exactly once and returns false on exhaustion; skip returns false when there
 * is no further match; remove-last returns false when only the main range remains.
 */
import { EditorSelection } from "@codemirror/state";
import {
  SearchCursor,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import { EditorView } from "@codemirror/view";

/**
 * Find the next occurrence of `query` after the last selection range.
 * Wraps around the document once; returns null when exhausted.
 * Honours whole-word matching when the original selection is a full word.
 */
function findNextOccurrenceRange(
  view: EditorView,
  query: string,
): { from: number; to: number } | null {
  const { state } = view;
  const { main, ranges } = state.selection;

  const word = state.wordAt(main.head);
  const fullWord = Boolean(
    word && word.from === main.from && word.to === main.to,
  );

  // First pass: search forward from the end of the last range.
  for (
    let cycled = false, cursor = new SearchCursor(state.doc, query, ranges[ranges.length - 1]!.to);
    ;

  ) {
    cursor.next();
    if (cursor.done) {
      if (cycled) {
        return null;
      }
      // Wrap: search from start to just before the last range.
      cursor = new SearchCursor(
        state.doc,
        query,
        0,
        Math.max(0, ranges[ranges.length - 1]!.from - 1),
      );
      cycled = true;
      continue;
    }
    const value = cursor.value;
    // After wrapping, skip ranges already selected.
    if (cycled && ranges.some((r) => r.from === value.from)) {
      continue;
    }
    if (fullWord) {
      const w = state.wordAt(value.from);
      if (!w || w.from !== value.from || w.to !== value.to) {
        continue;
      }
    }
    return { from: value.from, to: value.to };
  }
}

/** Result of an occurrence-selection action. */
export type OccurrenceResult = {
  /** Whether the action applied a change. */
  ok: boolean;
  /** Human-readable status message (undefined when ok and no feedback needed). */
  message?: string;
};

/**
 * Select the next occurrence of the current selection.
 *
 * When any selection is empty, CodeMirror's `selectNextOccurrence` first
 * expands to the word at the cursor. A second invocation (all non-empty)
 * finds and adds the next match. This wrapper transparently chains both
 * steps so the user gets a range on every press.
 */
export function selectNextOccurrenceOp(view: EditorView): OccurrenceResult {
  const { state } = view;
  // Empty selections: delegate to CodeMirror which expands to the word at cursor.
  if (state.selection.ranges.some((r) => r.empty)) {
    const applied = selectNextOccurrence(view);
    return applied ? { ok: true } : { ok: false, message: "No matching occurrence" };
  }

  // All ranges are non-empty — ensure they share the same selected text.
  const query = state.sliceDoc(
    state.selection.ranges[0]!.from,
    state.selection.ranges[0]!.to,
  );
  if (state.selection.ranges.some((r) => state.sliceDoc(r.from, r.to) !== query)) {
    return { ok: false, message: "Selections differ" };
  }

  const next = findNextOccurrenceRange(view, query);
  if (!next) {
    return { ok: false, message: "No more occurrences" };
  }

  view.dispatch({
    selection: state.selection.addRange(
      EditorSelection.range(next.from, next.to),
      false,
    ),
    effects: EditorView.scrollIntoView(next.to),
    userEvent: "select.search.next",
  });
  return { ok: true };
}

/** Select all occurrences of the currently selected text. */
export function selectAllOccurrencesOp(view: EditorView): OccurrenceResult {
  const { state } = view;
  if (state.selection.main.empty && state.selection.ranges.length <= 1) {
    return { ok: false, message: "Select text first" };
  }
  const applied = selectSelectionMatches(view);
  return applied
    ? { ok: true }
    : { ok: false, message: "No more occurrences" };
}

/**
 * Skip the current (main) occurrence: advance the main selection to the next
 * match without adding a new range. The previous main range is dropped.
 */
export function skipOccurrenceOp(view: EditorView): OccurrenceResult {
  const { state } = view;
  if (state.selection.main.empty) {
    return { ok: false, message: "Select text first" };
  }
  const query = state.sliceDoc(state.selection.main.from, state.selection.main.to);
  if (!query) {
    return { ok: false, message: "Select text first" };
  }

  const next = findNextOccurrenceRange(view, query);
  if (!next) {
    return { ok: false, message: "No more occurrences" };
  }

  // Replace the main range with the next occurrence.
  const ranges = state.selection.ranges.map((r, i) =>
    i === state.selection.mainIndex
      ? EditorSelection.range(next.from, next.to)
      : r,
  );
  view.dispatch({
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    effects: EditorView.scrollIntoView(next.to),
    userEvent: "select.search.skip",
  });
  return { ok: true };
}

/**
 * Remove the most recently added secondary occurrence selection.
 * Returns to the main selection when only one range remains.
 */
export function undoOccurrenceOp(view: EditorView): OccurrenceResult {
  const { state } = view;
  if (state.selection.ranges.length <= 1) {
    return { ok: false, message: "No occurrence to remove" };
  }

  // Remove the last range in document order (most recently added).
  const ranges = [...state.selection.ranges].sort((a, b) => a.from - b.from);
  const removed = ranges[ranges.length - 1]!;
  const remaining = ranges.slice(0, -1);

  let mainIndex = state.selection.mainIndex;
  // If we removed the main, shift main to the new last range.
  if (removed === state.selection.main) {
    mainIndex = remaining.length - 1;
  } else {
    // Recompute main index in the remaining set.
    const mainFrom = state.selection.main.from;
    mainIndex = Math.max(
      0,
      remaining.findIndex((r) => r.from === mainFrom),
    );
    if (mainIndex < 0) {
      mainIndex = remaining.length - 1;
    }
  }

  view.dispatch({
    selection: EditorSelection.create(remaining, mainIndex),
    userEvent: "select.search.undo",
  });
  return { ok: true };
}
