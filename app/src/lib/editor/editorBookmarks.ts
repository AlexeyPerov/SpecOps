/**
 * CodeMirror bookmark extensions: ephemeral per-document-view line bookmarks.
 *
 * Bookmarks live entirely in `EditorState` via a `StateField`. They are never
 * written to app session storage, settings, or any persisted schema — closing
 * and reopening a file starts with no bookmarks. The field stores a sorted
 * array of document positions; CodeMirror's change-mapping keeps each position
 * attached to its line through insertions/deletions. Positions that collapse
 * onto the same line are deduplicated, and positions mapped past the document
 * end are clamped to the last line.
 *
 * The gutter coexists with the line-number gutter and the M4 fold gutter
 * (CodeMirror stacks gutters left-to-right). Markers are accessible buttons
 * with aria labels; clicking toggles the bookmark on that line.
 */
import {
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";
import type { EditorBookmarkSnapshot } from "../types/editor";

/** Maximum characters of line preview exposed to the list picker / UI. */
const PREVIEW_MAX_CHARS = 80;

/**
 * Sorted, deduplicated bookmark positions. Stored as positions (not line
 * numbers) so CodeMirror maps them through document changes automatically.
 */
export type BookmarkState = readonly number[];

/** Effect payload: positions to toggle (each maps to one main line). */
export type ToggleBookmarkEffect = {
  positions: readonly number[];
};

/** Effect payload: line numbers to remove (used by gutter clicks). */
export type RemoveBookmarkLinesEffect = {
  lines: readonly number[];
};

export const toggleBookmarkEffect = StateEffect.define<ToggleBookmarkEffect>();
export const clearAllBookmarksEffect = StateEffect.define<null>();
export const removeBookmarkLinesEffect = StateEffect.define<RemoveBookmarkLinesEffect>();

function compareNumbers(a: number, b: number): number {
  return a - b;
}

function sortedUnique(positions: readonly number[]): number[] {
  const sorted = [...positions].sort(compareNumbers);
  const out: number[] = [];
  for (const pos of sorted) {
    if (out.length === 0 || out[out.length - 1] !== pos) {
      out.push(pos);
    }
  }
  return out;
}

/** Minimal document shape used by bookmark helpers (line lookup + length). */
type BookmarkDoc = {
  length: number;
  lineAt: (pos: number) => { number: number; from: number; to: number };
};

/** Convert a position to its line number in the given document. */
function lineOfPosition(doc: BookmarkDoc, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, Math.max(0, doc.length - 1)));
  return doc.lineAt(clamped).number;
}

/**
 * Merge new positions into the bookmark set, toggling by line number: if a
 * target line already has a bookmark, remove it; otherwise add the position.
 *
 * Multiple input positions on the same line are deduplicated to a single
 * toggle for that line (multi-cursor on one line = one bookmark flip).
 */
function applyToggle(
  current: BookmarkState,
  doc: BookmarkDoc,
  positions: readonly number[],
): number[] {
  const linesToExistingPos = new Map<number, number>();
  for (const pos of current) {
    const line = lineOfPosition(doc, pos);
    // Keep the first (lowest) position per line for toggle comparisons.
    if (!linesToExistingPos.has(line) || linesToExistingPos.get(line)! > pos) {
      linesToExistingPos.set(line, pos);
    }
  }
  // Collapse input positions to one per line (the line's start), so multiple
  // selections on the same line flip the bookmark once instead of cancelling.
  const inputLines = new Map<number, number>();
  for (const pos of positions) {
    const line = lineOfPosition(doc, pos);
    if (!inputLines.has(line)) {
      inputLines.set(line, doc.lineAt(Math.max(0, Math.min(pos, Math.max(0, doc.length - 1)))).from);
    }
  }
  const next = new Set(current);
  for (const [line, lineFrom] of inputLines) {
    const existing = linesToExistingPos.get(line);
    if (existing !== undefined) {
      next.delete(existing);
      linesToExistingPos.delete(line);
    } else {
      next.add(lineFrom);
      linesToExistingPos.set(line, lineFrom);
    }
  }
  return sortedUnique([...next]);
}

function applyRemoveLines(
  current: BookmarkState,
  doc: BookmarkDoc,
  lines: readonly number[],
): number[] {
  const removeSet = new Set(lines);
  return sortedUnique(
    current.filter((pos) => !removeSet.has(lineOfPosition(doc, pos))),
  );
}

/**
 * Re-dedupe bookmark positions by line after a document change. Two positions
 * that mapped onto the same surviving line collapse into the line's start.
 */
function dedupeByLine(
  positions: readonly number[],
  doc: BookmarkDoc,
): number[] {
  const byLine = new Map<number, number>();
  for (const raw of positions) {
    const clamped = Math.max(0, Math.min(raw, Math.max(0, doc.length - 1)));
    const line = lineOfPosition(doc, clamped);
    const lineFrom = doc.lineAt(clamped).from;
    if (!byLine.has(line)) {
      byLine.set(line, lineFrom);
    } else if (lineFrom < byLine.get(line)!) {
      byLine.set(line, lineFrom);
    }
  }
  return sortedUnique([...byLine.values()]);
}

/**
 * Bookmark state field. Stores sorted, deduplicated document positions and
 * lets CodeMirror map each position through document changes. After each
 * transaction the set is re-deduped by line so collapsed positions merge.
 */
export const bookmarkField: StateField<BookmarkState> = StateField.define<BookmarkState>({
  create: () => [],
  update(value, tr) {
    if (tr.docChanged || tr.effects.length > 0) {
      // Map each bookmark position through the transaction's changes. CodeMirror
      // biases a mapped position to the end of an inserted range by default;
      // `mapPos(pos, -1)` biases left so a deleted line's bookmark lands on the
      // first surviving line instead of jumping to the next line start.
      const mapped = value.map((pos) => Math.max(0, tr.changes.mapPos(pos, -1)));
      let next = sortedUnique(mapped);
      let handled = false;
      for (const effect of tr.effects) {
        if (effect.is(clearAllBookmarksEffect)) {
          handled = true;
          next = [];
        } else if (effect.is(removeBookmarkLinesEffect)) {
          handled = true;
          next = applyRemoveLines(next, tr.newDoc, effect.value.lines);
        } else if (effect.is(toggleBookmarkEffect)) {
          handled = true;
          next = applyToggle(next, tr.newDoc, effect.value.positions);
        }
      }
      // Re-dedupe by line after any change so positions collapsing onto the
      // same surviving line merge into the line's start.
      return dedupeByLine(next, tr.newDoc);
    }
    return value;
  },
});

/**
 * Read the bookmark line numbers for a document. Pure helper usable in tests
 * without a live view.
 */
export function bookmarkLines(
  doc: BookmarkDoc,
  positions: BookmarkState,
): number[] {
  return positions.map((pos) => lineOfPosition(doc, pos));
}

/** Build bounded, trimmed preview rows for the bookmark list picker. */
export function bookmarkSnapshots(
  doc: {
    length: number;
    lineAt: (pos: number) => {
      number: number;
      from: number;
      to: number;
      text: string;
    };
    sliceString: (from: number, to: number) => string;
  },
  positions: BookmarkState,
): EditorBookmarkSnapshot[] {
  const sorted = sortedUnique([...positions]);
  return sorted.map((pos) => {
    const line = doc.lineAt(pos);
    const rawText = doc.sliceString(line.from, line.to);
    const trimmed = rawText.trim();
    const preview =
      trimmed.length > PREVIEW_MAX_CHARS
        ? `${trimmed.slice(0, PREVIEW_MAX_CHARS)}…`
        : trimmed;
    return {
      line: line.number,
      from: line.from,
      to: line.to,
      preview,
    };
  });
}

export type BookmarkDirection = "next" | "previous";

/**
 * Resolve the next/previous bookmark line relative to the cursor, wrapping
 * within the document. Returns null when there are no bookmarks.
 *
 * "Next" advances forward in document order, wrapping to the first bookmark
 * when the cursor is at/after the last one. "Previous" goes backward, wrapping
 * to the last bookmark when the cursor is at/before the first one.
 */
export function nextBookmarkLine(
  doc: BookmarkDoc,
  positions: BookmarkState,
  cursorPos: number,
  direction: BookmarkDirection,
): number | null {
  const lines = bookmarkLines(doc, positions);
  if (lines.length === 0) {
    return null;
  }
  const cursorLine = lineOfPosition(doc, cursorPos);
  if (direction === "next") {
    const ahead = lines.filter((line) => line > cursorLine);
    if (ahead.length > 0) {
      return ahead[0]!;
    }
    // Wrap: jump to the first bookmark. If the cursor is already on a
    // bookmark, still move to the next one (not stay in place).
    const onOrAhead = lines.filter((line) => line >= cursorLine);
    if (onOrAhead.length > 1) {
      return onOrAhead[1]!;
    }
    return lines[0]!;
  }
  // previous
  const behind = lines.filter((line) => line < cursorLine);
  if (behind.length > 0) {
    return behind[behind.length - 1]!;
  }
  const onOrBehind = lines.filter((line) => line <= cursorLine);
  if (onOrBehind.length > 1) {
    return onOrBehind[onOrBehind.length - 2]!;
  }
  return lines[lines.length - 1]!;
}

class BookmarkGutterMarker extends GutterMarker {
  override toDOM(): HTMLElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "cm-bookmarkMarker";
    el.setAttribute("aria-label", "Bookmark on this line");
    el.title = "Bookmark";
    el.tabIndex = -1;
    el.textContent = "★";
    return el;
  }
}

const MARKER = new BookmarkGutterMarker();

/** Build a RangeSet of bookmark markers from the current positions. */
function markersFor(positions: BookmarkState): RangeSet<GutterMarker> {
  // RangeSet.of takes an array of {from, to, value} and sorts/dedupes.
  return RangeSet.of(
    sortedUnique([...positions]).map((pos) => ({
      from: pos,
      to: pos,
      value: MARKER,
    })),
  );
}

function lineFromEvent(view: EditorView, event: MouseEvent): number | null {
  const refRect = view.dom.getBoundingClientRect();
  const y = event.clientY - refRect.top + view.scrollDOM.scrollTop;
  const block = view.lineBlockAtHeight(y);
  if ("from" in block && typeof block.from === "number") {
    return view.state.doc.lineAt(block.from).number;
  }
  return null;
}

/** Theme rules for the bookmark gutter and marker. */
export function bookmarkTheme(): Extension {
  return EditorView.theme({
    ".cm-bookmarkGutter": {
      width: "14px",
    },
    ".cm-bookmarkGutter .cm-gutterElement": {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0",
    },
    ".cm-bookmarkMarker": {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "12px",
      height: "12px",
      margin: "0",
      padding: "0",
      border: "none",
      background: "transparent",
      color: "var(--color-accent, var(--color-text-primary))",
      fontSize: "11px",
      lineHeight: "1",
      cursor: "pointer",
    },
    ".cm-bookmarkMarker:hover": {
      color: "var(--color-text-primary)",
    },
  });
}

/**
 * Bookmark extension group for the reserved `landmarks` compartment.
 *
 * Always registered (cheap when empty); bookmarks are ephemeral and never
 * persisted. The gutter coexists with the line-number and fold gutters.
 */
export function bookmarkExtension(): Extension {
  return [
    bookmarkField,
    gutter({
      class: "cm-bookmarkGutter",
      markers: (view) => {
        const positions = view.state.field(bookmarkField, false) ?? [];
        return markersFor(positions);
      },
    }),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const line = lineFromEvent(view, event);
        if (line == null) {
          return;
        }
        view.dispatch({
          effects: toggleBookmarkEffect.of({
            positions: [view.state.doc.line(line).from],
          }),
        });
        return false;
      },
    }),
    bookmarkTheme(),
  ];
}

/** Map a transaction's effects/doc changes for tests without a live view. */
export function reduceTransaction(
  current: BookmarkState,
  tr: Transaction,
): BookmarkState {
  if (!tr.docChanged && tr.effects.length === 0) {
    return current;
  }
  const mapped = current.map((pos) => Math.max(0, tr.changes.mapPos(pos, -1)));
  let next = sortedUnique(mapped);
  for (const effect of tr.effects) {
    if (effect.is(clearAllBookmarksEffect)) {
      next = [];
    } else if (effect.is(removeBookmarkLinesEffect)) {
      next = applyRemoveLines(next, tr.newDoc, effect.value.lines);
    } else if (effect.is(toggleBookmarkEffect)) {
      next = applyToggle(next, tr.newDoc, effect.value.positions);
    }
  }
  return dedupeByLine(next, tr.newDoc);
}
