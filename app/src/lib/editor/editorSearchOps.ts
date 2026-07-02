import { EditorSelection, type Compartment } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { MatchInfo } from "../types/editor";
import { createSearchHighlightExtension, findAllMatches } from "./searchHighlight";

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

export function editorFindNext(
  view: EditorView | undefined,
  query: string,
  caseSensitive: boolean,
): boolean {
  if (!view || query.length === 0) {
    return false;
  }
  const doc = view.state.doc.toString();
  const idx = findNextMatchIndex(doc, query, caseSensitive, view.state.selection.main.to);
  if (idx === null) {
    return false;
  }
  view.dispatch({
    selection: EditorSelection.range(idx, idx + query.length),
    scrollIntoView: true,
  });
  return true;
}

export function editorFindPrevious(
  view: EditorView | undefined,
  query: string,
  caseSensitive: boolean,
): boolean {
  if (!view || query.length === 0) {
    return false;
  }
  const doc = view.state.doc.toString();
  const idx = findPreviousMatchIndex(
    doc,
    query,
    caseSensitive,
    view.state.selection.main.from,
  );
  if (idx === null) {
    return false;
  }
  view.dispatch({
    selection: EditorSelection.range(idx, idx + query.length),
    scrollIntoView: true,
  });
  return true;
}

export function editorReplaceCurrent(
  view: EditorView | undefined,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): boolean {
  if (!view || query.length === 0) {
    return false;
  }
  const sel = view.state.selection.main;
  const selectedText = view.state.sliceDoc(sel.from, sel.to);
  if (!selectionMatchesQuery(selectedText, query, caseSensitive)) {
    return false;
  }
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: replacement },
    selection: EditorSelection.range(sel.from, sel.from + replacement.length),
    userEvent: "input",
  });
  return true;
}

export function editorReplaceAll(
  view: EditorView | undefined,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): number {
  if (!view || query.length === 0) {
    return 0;
  }
  const source = view.state.doc.toString();
  const { changes, count } = buildReplaceAllChanges(
    source,
    query,
    replacement,
    caseSensitive,
  );
  if (changes.length > 0) {
    view.dispatch({ changes, userEvent: "input" });
  }
  return count;
}

export function editorReplaceAndFindNext(
  view: EditorView | undefined,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): boolean {
  if (!view || query.length === 0) {
    return false;
  }
  const sel = view.state.selection.main;
  const selectedText = view.state.sliceDoc(sel.from, sel.to);
  if (selectionMatchesQuery(selectedText, query, caseSensitive)) {
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: replacement },
      selection: EditorSelection.range(sel.from, sel.from + replacement.length),
      userEvent: "input",
    });
  }
  return editorFindNext(view, query, caseSensitive);
}

export function editorSetSearchQuery(
  view: EditorView | undefined,
  query: string,
  caseSensitive: boolean,
  searchHighlightCompartment: Compartment,
): void {
  if (!view) {
    return;
  }
  view.dispatch({
    effects: searchHighlightCompartment.reconfigure(
      query ? [createSearchHighlightExtension(query, caseSensitive)] : [],
    ),
  });
}

export function editorGetMatchInfo(
  view: EditorView | undefined,
  query: string,
  caseSensitive: boolean,
): MatchInfo {
  if (!view || query.length === 0) {
    return { total: 0, current: 0 };
  }
  const doc = view.state.doc.toString();
  const matches = findAllMatches(doc, query, caseSensitive);
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
