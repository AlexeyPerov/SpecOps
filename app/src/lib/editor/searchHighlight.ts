import { Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { findAllRangesInText, type SearchQuery } from "./searchQuery";

export interface MatchPosition {
  from: number;
  to: number;
}

const matchDeco = Decoration.mark({ class: "cm-search-match" });
const currentMatchDeco = Decoration.mark({ class: "cm-search-match-current" });

/**
 * Find all match ranges in a plain string (literal, case toggle only).
 * Delegates to the unified query model so editor and project search share one
 * matching engine. Legacy callers that pass a raw string + case flag are kept
 * compatible; project search now calls the richer `findAllRangesInString`.
 */
export function findAllMatches(
  doc: string,
  query: string,
  caseSensitive: boolean,
): MatchPosition[] {
  if (!query) return [];
  const sq: SearchQuery = {
    text: query,
    replacement: "",
    caseSensitive,
    wholeWord: false,
    regexp: false,
  };
  return findAllRangesInText(Text.of(doc.split("\n")), sq);
}

function buildDecorations(
  view: EditorView,
  query: SearchQuery,
): DecorationSet {
  if (!query.text) return Decoration.none;
  const matches = findAllRangesInText(view.state.doc, query);
  if (matches.length === 0) return Decoration.none;

  const sel = view.state.selection.main;
  const ranges = matches.map((m) => {
    const isCurrent = m.from === sel.from && m.to === sel.to;
    return (isCurrent ? currentMatchDeco : matchDeco).range(m.from, m.to);
  });
  return Decoration.set(ranges, true);
}

export function createSearchHighlightExtension(query: SearchQuery) {
  const q = query;

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, q);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view, q);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
