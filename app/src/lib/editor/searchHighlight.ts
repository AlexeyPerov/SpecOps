import { Compartment } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

export interface MatchPosition {
  from: number;
  to: number;
}

const matchDeco = Decoration.mark({ class: "cm-search-match" });
const currentMatchDeco = Decoration.mark({ class: "cm-search-match-current" });

export function findAllMatches(
  doc: string,
  query: string,
  caseSensitive: boolean,
): MatchPosition[] {
  if (!query) return [];
  const haystack = caseSensitive ? doc : doc.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: MatchPosition[] = [];
  let pos = 0;
  while (pos < haystack.length) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    matches.push({ from: idx, to: idx + query.length });
    pos = idx + Math.max(1, query.length);
  }
  return matches;
}

function buildDecorations(
  view: EditorView,
  query: string,
  caseSensitive: boolean,
): DecorationSet {
  if (!query) return Decoration.none;
  const doc = view.state.doc.toString();
  const matches = findAllMatches(doc, query, caseSensitive);
  if (matches.length === 0) return Decoration.none;

  const sel = view.state.selection.main;
  const ranges = matches.map((m) => {
    const isCurrent = m.from === sel.from && m.to === sel.to;
    return (isCurrent ? currentMatchDeco : matchDeco).range(m.from, m.to);
  });
  return Decoration.set(ranges, true);
}

export function createSearchHighlightExtension(
  query: string,
  caseSensitive: boolean,
) {
  const q = query;
  const cs = caseSensitive;

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, q, cs);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view, q, cs);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export const searchHighlightCompartment = new Compartment();
