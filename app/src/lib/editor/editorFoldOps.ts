/**
 * Fold domain operations over a live EditorView.
 */
import {
  foldAll,
  foldCode,
  foldedRanges,
  toggleFold,
  unfoldAll,
  unfoldCode,
  unfoldEffect,
} from "@codemirror/language";
import type { EditorView } from "@codemirror/view";

export function foldToggle(view: EditorView): boolean {
  return toggleFold(view);
}

export function foldCurrent(view: EditorView): boolean {
  return foldCode(view);
}

export function unfoldCurrent(view: EditorView): boolean {
  return unfoldCode(view);
}

export function foldAllRanges(view: EditorView): boolean {
  return foldAll(view);
}

export function unfoldAllRanges(view: EditorView): boolean {
  return unfoldAll(view);
}

/**
 * Unfold every folded range that covers `pos` (or starts on its line) so a
 * jump target becomes visible.
 */
export function unfoldAroundPosition(view: EditorView, pos: number): void {
  const folded = foldedRanges(view.state);
  const effects: ReturnType<typeof unfoldEffect.of>[] = [];
  const line = view.state.doc.lineAt(pos);
  folded.between(0, view.state.doc.length, (from, to) => {
    if ((from <= pos && pos <= to) || (from >= line.from && from <= line.to)) {
      effects.push(unfoldEffect.of({ from, to }));
    }
  });
  if (effects.length > 0) {
    view.dispatch({ effects });
  }
}

/** True when a fold starts on the given line (heading-line fold marker closed). */
export function isLineFolded(view: EditorView, lineNumber: number): boolean {
  if (lineNumber < 1 || lineNumber > view.state.doc.lines) {
    return false;
  }
  const line = view.state.doc.line(lineNumber);
  let folded = false;
  foldedRanges(view.state).between(line.from, line.to, (from) => {
    if (from >= line.from && from <= line.to) {
      folded = true;
    }
  });
  return folded;
}
