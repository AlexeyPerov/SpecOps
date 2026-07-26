import { Text } from "@codemirror/state";
import type { Range } from "@codemirror/state";
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

/**
 * Characters scanned either side of a visible range.
 *
 * `visibleRanges` are clipped to rendered content, so a match straddling the boundary
 * would otherwise be missed and flicker into existence on scroll. A margin costs one
 * extra line or two of scanning and removes the artefact.
 */
const VIEWPORT_SCAN_MARGIN = 2000;

function buildDecorations(
  view: EditorView,
  query: SearchQuery,
): DecorationSet {
  if (!query.text) return Decoration.none;

  const sel = view.state.selection.main;
  const ranges: Range<Decoration>[] = [];
  // Padded viewport ranges can overlap, so the same match may be found twice.
  const seen = new Set<string>();
  // Only the visible ranges are scanned. Decorations outside the viewport are never
  // rendered, so building them meant a full-document `RegExpCursor` sweep on every
  // keystroke, scroll and cursor move for nothing.
  for (const visible of view.visibleRanges) {
    const matches = findAllRangesInText(view.state.doc, query, {
      from: visible.from - VIEWPORT_SCAN_MARGIN,
      to: visible.to + VIEWPORT_SCAN_MARGIN,
    });
    for (const match of matches) {
      const key = `${match.from}:${match.to}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const isCurrent = match.from === sel.from && match.to === sel.to;
      ranges.push((isCurrent ? currentMatchDeco : matchDeco).range(match.from, match.to));
    }
  }
  if (ranges.length === 0) return Decoration.none;
  return Decoration.set(ranges, true);
}

/**
 * True when a selection change could alter which match is highlighted as current.
 *
 * The current-match decoration only applies to a selection that exactly covers a match,
 * and a match is never empty. So moving the caret between two empty selections — arrow
 * keys, clicking around the document — cannot change anything, and used to trigger a
 * full rebuild anyway.
 */
function selectionCouldAffectHighlight(update: ViewUpdate): boolean {
  return !update.startState.selection.main.empty || !update.state.selection.main.empty;
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
        if (
          update.docChanged ||
          update.viewportChanged ||
          (update.selectionSet && selectionCouldAffectHighlight(update))
        ) {
          this.decorations = buildDecorations(update.view, q);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
