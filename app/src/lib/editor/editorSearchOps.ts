import { EditorSelection, Text, type Compartment } from "@codemirror/state";
import { RegExpCursor } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import type { MatchInfo } from "../types/editor";
import { createSearchHighlightExtension } from "./searchHighlight";
import {
  buildReplaceAllChanges as buildQueryReplaceAllChanges,
  compileQueryInternal,
  expandReplacement,
  findAllRangesInText,
  type SearchQuery,
} from "./searchQuery";

// ---------------------------------------------------------------------------
// Legacy pure helpers (kept for backward-compatible tests and callers that
// operate on raw strings with a case flag only). New code should prefer the
// SearchQuery-based functions below.
// ---------------------------------------------------------------------------

export function normalizeForSearch(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

export function findNextMatchIndex(
  doc: string,
  query: string,
  caseSensitive: boolean,
  from: number,
): number | null {
  if (query.length === 0) {
    return null;
  }
  const haystack = normalizeForSearch(doc, caseSensitive);
  const needle = normalizeForSearch(query, caseSensitive);
  let idx = haystack.indexOf(needle, from);
  if (idx === -1) {
    idx = haystack.indexOf(needle, 0);
  }
  if (idx === -1) {
    return null;
  }
  return idx;
}

export function findPreviousMatchIndex(
  doc: string,
  query: string,
  caseSensitive: boolean,
  from: number,
): number | null {
  if (query.length === 0) {
    return null;
  }
  const haystack = normalizeForSearch(doc, caseSensitive);
  const needle = normalizeForSearch(query, caseSensitive);
  let idx = from > 0 ? haystack.lastIndexOf(needle, from - 1) : -1;
  if (idx === -1) {
    idx = haystack.lastIndexOf(needle);
  }
  if (idx === -1) {
    return null;
  }
  return idx;
}

export function selectionMatchesQuery(
  selectedText: string,
  query: string,
  caseSensitive: boolean,
): boolean {
  return (
    normalizeForSearch(selectedText, caseSensitive) ===
    normalizeForSearch(query, caseSensitive)
  );
}

export function replaceSelectionText(
  text: string,
  from: number,
  to: number,
  replacement: string,
): { text: string; from: number; to: number } {
  const rebuilt = `${text.slice(0, from)}${replacement}${text.slice(to)}`;
  return {
    text: rebuilt,
    from,
    to: from + replacement.length,
  };
}

export function countReplaceAllMatches(
  source: string,
  query: string,
  caseSensitive: boolean,
): number {
  if (query.length === 0) {
    return 0;
  }
  const haystack = normalizeForSearch(source, caseSensitive);
  const needle = normalizeForSearch(query, caseSensitive);
  let index = 0;
  let count = 0;
  while (index < haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      break;
    }
    count += 1;
    index = found + Math.max(1, query.length);
  }
  return count;
}

/**
 * Legacy literal replace-all on a raw string. Kept for callers that predate the
 * SearchQuery model (e.g. project file ops compatibility during migration).
 * New callers should use `replaceAllInString(source, query)` from searchQuery.ts.
 */
export function applyReplaceAll(
  source: string,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): { text: string; count: number } {
  if (query.length === 0) {
    return { text: source, count: 0 };
  }
  const haystack = normalizeForSearch(source, caseSensitive);
  const needle = normalizeForSearch(query, caseSensitive);
  let index = 0;
  let count = 0;
  const pieces: string[] = [];
  let cursor = 0;
  while (index < haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      break;
    }
    if (found > cursor) {
      pieces.push(source.slice(cursor, found));
    }
    pieces.push(replacement);
    count += 1;
    cursor = found + query.length;
    index = found + Math.max(1, query.length);
  }
  if (count === 0) {
    return { text: source, count: 0 };
  }
  if (cursor < source.length) {
    pieces.push(source.slice(cursor));
  }
  return { text: pieces.join(""), count };
}

export function buildReplaceAllChanges(
  source: string,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): { changes: { from: number; to: number; insert: string }[]; count: number } {
  if (query.length === 0) {
    return { changes: [], count: 0 };
  }
  const haystack = normalizeForSearch(source, caseSensitive);
  const needle = normalizeForSearch(query, caseSensitive);
  let index = 0;
  let count = 0;
  const changes: { from: number; to: number; insert: string }[] = [];
  while (index < haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      break;
    }
    changes.push({ from: found, to: found + query.length, insert: replacement });
    count += 1;
    index = found + Math.max(1, query.length);
  }
  return { changes, count };
}

// ---------------------------------------------------------------------------
// SearchQuery-based editor operations (M8.1). These drive in-file find/replace
// through the unified query model, supporting regex, whole-word, and capture
// expansion. They dispatch mapped CodeMirror changes (no full-document rebuild)
// and preserve multi-selection intentionally.
// ---------------------------------------------------------------------------

/** Find the next match at/after `from`, wrapping to the start. */
export function findNextRange(
  doc: Text,
  query: SearchQuery,
  from: number,
): { from: number; to: number } | null {
  const compiled = compileQueryInternal(query);
  if (!compiled) return null;
  try {
    // First pass: forward from `from` to end of document.
    let cursor = new RegExpCursor(
      doc,
      compiled.source,
      { ignoreCase: compiled.ignoreCase },
      from,
    );
    if (!cursor.next().done) {
      return { from: cursor.value.from, to: cursor.value.to };
    }
    // Wrap: search from the document start up to `from`.
    cursor = new RegExpCursor(
      doc,
      compiled.source,
      { ignoreCase: compiled.ignoreCase },
      0,
      from > 0 ? from - 1 : 0,
    );
    if (!cursor.next().done) {
      return { from: cursor.value.from, to: cursor.value.to };
    }
  } catch {
    return null;
  }
  return null;
}

/** Find the previous match before `from`, wrapping to the end. */
export function findPreviousRange(
  doc: Text,
  query: SearchQuery,
  from: number,
): { from: number; to: number } | null {
  const compiled = compileQueryInternal(query);
  if (!compiled) return null;
  try {
    // Collect matches before `from`, then take the last one.
    const cursor = new RegExpCursor(
      doc,
      compiled.source,
      { ignoreCase: compiled.ignoreCase },
      0,
      from > 0 ? from : 0,
    );
    let last: { from: number; to: number } | null = null;
    while (!cursor.next().done) {
      const v = cursor.value;
      if (v.from < from) {
        last = { from: v.from, to: v.to };
      }
    }
    if (last) return last;
    // Wrap: find the last match at/after `from` in the whole document.
    const wrapCursor = new RegExpCursor(
      doc,
      compiled.source,
      { ignoreCase: compiled.ignoreCase },
    );
    while (!wrapCursor.next().done) {
      const v = wrapCursor.value;
      if (v.from >= from) {
        last = { from: v.from, to: v.to };
      }
    }
    return last;
  } catch {
    return null;
  }
}

export function editorFindNext(view: EditorView | undefined, query: SearchQuery): boolean {
  if (!view || !query.text) {
    return false;
  }
  const range = findNextRange(view.state.doc, query, view.state.selection.main.to);
  if (!range) {
    return false;
  }
  view.dispatch({
    selection: EditorSelection.range(range.from, range.to),
    scrollIntoView: true,
  });
  return true;
}

export function editorFindPrevious(view: EditorView | undefined, query: SearchQuery): boolean {
  if (!view || !query.text) {
    return false;
  }
  const range = findPreviousRange(view.state.doc, query, view.state.selection.main.from);
  if (!range) {
    return false;
  }
  view.dispatch({
    selection: EditorSelection.range(range.from, range.to),
    scrollIntoView: true,
  });
  return true;
}

export function editorReplaceCurrent(
  view: EditorView | undefined,
  query: SearchQuery,
): boolean {
  if (!view || !query.text) {
    return false;
  }
  const sel = view.state.selection.main;
  // Only replace when the current selection is an exact match for the query.
  const matches = findAllRangesInText(view.state.doc, query);
  const isMatch = matches.some((m) => m.from === sel.from && m.to === sel.to);
  if (!isMatch) {
    return false;
  }
  const selectedText = view.state.sliceDoc(sel.from, sel.to);
  const insert = query.regexp
    ? expandReplacement(
        query.replacement,
        runMatch(query.text, selectedText, query.caseSensitive),
        true,
      )
    : query.replacement;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: EditorSelection.range(sel.from, sel.from + insert.length),
    userEvent: "input",
  });
  return true;
}

export function editorReplaceAll(view: EditorView | undefined, query: SearchQuery): number {
  if (!view || !query.text) {
    return 0;
  }
  const source = view.state.doc.toString();
  const { changes, count } = buildQueryReplaceAllChanges(source, query);
  if (changes.length > 0) {
    view.dispatch({ changes, userEvent: "input" });
  }
  return count;
}

export function editorReplaceAndFindNext(
  view: EditorView | undefined,
  query: SearchQuery,
): boolean {
  if (!view || !query.text) {
    return false;
  }
  const sel = view.state.selection.main;
  const matches = findAllRangesInText(view.state.doc, query);
  const isMatch = matches.some((m) => m.from === sel.from && m.to === sel.to);
  if (isMatch) {
    const selectedText = view.state.sliceDoc(sel.from, sel.to);
    const insert = query.regexp
      ? expandReplacement(
          query.replacement,
          runMatch(query.text, selectedText, query.caseSensitive),
          true,
        )
      : query.replacement;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: EditorSelection.range(sel.from, sel.from + insert.length),
      userEvent: "input",
    });
  }
  return editorFindNext(view, query);
}

export function editorSetSearchQuery(
  view: EditorView | undefined,
  query: SearchQuery,
  searchHighlightCompartment: Compartment,
): void {
  if (!view) {
    return;
  }
  view.dispatch({
    effects: searchHighlightCompartment.reconfigure(
      query.text ? [createSearchHighlightExtension(query)] : [],
    ),
  });
}

export function editorGetMatchInfo(
  view: EditorView | undefined,
  query: SearchQuery,
): MatchInfo {
  if (!view || !query.text) {
    return { total: 0, current: 0 };
  }
  const matches = findAllRangesInText(view.state.doc, query);
  if (matches.length === 0) {
    return { total: 0, current: 0 };
  }
  const sel = view.state.selection.main;
  let current = 0;
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from === sel.from && matches[i].to === sel.to) {
      current = i + 1;
      break;
    }
  }
  return { total: matches.length, current };
}

/** Run the raw regex against a single match's text to obtain capture groups. */
function runMatch(
  pattern: string,
  text: string,
  caseSensitive: boolean,
): RegExpExecArray | null {
  try {
    return new RegExp(pattern, caseSensitive ? undefined : "i").exec(text);
  } catch {
    return null;
  }
}
