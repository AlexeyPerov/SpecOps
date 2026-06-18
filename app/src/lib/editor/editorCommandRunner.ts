import { Compartment, EditorSelection } from "@codemirror/state";
import { indentLess, indentMore, redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import type { EditorCommandRunner } from "../types/editor";
import {
  duplicateLineText,
  joinLinesText,
  moveLineDown,
  moveLineUp,
} from "./editorLineOps";
import {
  editorFindNext,
  editorFindPrevious,
  editorGetMatchInfo,
  editorReplaceAll,
  editorReplaceAndFindNext,
  editorReplaceCurrent,
  editorSetSearchQuery,
} from "./editorSearchOps";

export type CreateEditorCommandRunnerOptions = {
  getView: () => EditorView | undefined;
  lineWrapCompartment: Compartment;
  fontSizeCompartment: Compartment;
  searchHighlightCompartment: Compartment;
  onStatusMessage: (message: string) => void;
  updateCursor: () => void;
};

function withEditorSelection(
  view: EditorView,
  transform: (text: string, from: number, to: number) => {
    text: string;
    from: number;
    to: number;
    message?: string;
  },
  onStatusMessage: (message: string) => void,
): void {
  const state = view.state;
  const range = state.selection.main;
  const result = transform(state.doc.toString(), range.from, range.to);
  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: result.text },
    selection: EditorSelection.range(result.from, result.to),
    userEvent: "input",
  });
  if (result.message) {
    onStatusMessage(result.message);
  }
}

function applyWrap(
  view: EditorView,
  lineWrapCompartment: Compartment,
  nextWrap: boolean,
): void {
  view.dispatch({
    effects: lineWrapCompartment.reconfigure(
      nextWrap
        ? [
            EditorView.lineWrapping,
            EditorView.theme({
              ".cm-scroller": {
                overflowX: "hidden",
              },
            }),
          ]
        : [],
    ),
  });
}

function resolveEditorBaseFontSizePx(): number {
  if (typeof document !== "undefined") {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--font-size-editor")
      .trim();
    if (raw.length > 0) {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return 13;
}

function applyZoom(
  view: EditorView,
  fontSizeCompartment: Compartment,
  nextZoom: number,
): void {
  const base = resolveEditorBaseFontSizePx();
  const px = Math.round((base * nextZoom) / 100);
  view.dispatch({
    effects: fontSizeCompartment.reconfigure(
      EditorView.theme({
        "&": {
          fontSize: `${px}px`,
        },
      }),
    ),
  });
}

function goToLine(
  view: EditorView,
  line: number,
  updateCursor: () => void,
): boolean {
  if (!Number.isFinite(line) || line < 1) {
    return false;
  }
  const clampedLine = Math.min(line, view.state.doc.lines);
  const target = view.state.doc.line(clampedLine);
  view.dispatch({
    selection: EditorSelection.cursor(target.from),
    scrollIntoView: true,
  });
  updateCursor();
  return true;
}

export function createEditorCommandRunner(
  opts: CreateEditorCommandRunnerOptions,
): EditorCommandRunner {
  const {
    getView,
    lineWrapCompartment,
    fontSizeCompartment,
    searchHighlightCompartment,
    onStatusMessage,
    updateCursor,
  } = opts;

  function moveLine(direction: "up" | "down"): void {
    const view = getView();
    if (!view) {
      return;
    }
    withEditorSelection(
      view,
      (text, from, to) =>
        direction === "up" ? moveLineUp(text, from, to) : moveLineDown(text, from, to),
      onStatusMessage,
    );
  }

  function duplicateLine(): void {
    const view = getView();
    if (!view) {
      return;
    }
    withEditorSelection(view, duplicateLineText, onStatusMessage);
  }

  function joinLines(): void {
    const view = getView();
    if (!view) {
      return;
    }
    withEditorSelection(view, joinLinesText, onStatusMessage);
  }

  return {
    undo: () => {
      const view = getView();
      if (view) {
        undo(view);
      }
    },
    redo: () => {
      const view = getView();
      if (view) {
        redo(view);
      }
    },
    indent: () => {
      const view = getView();
      if (view) {
        indentMore(view);
      }
    },
    outdent: () => {
      const view = getView();
      if (view) {
        indentLess(view);
      }
    },
    moveLineUp: () => moveLine("up"),
    moveLineDown: () => moveLine("down"),
    duplicateLine,
    joinLines,
    setWrap: (value) => {
      const view = getView();
      if (view) {
        applyWrap(view, lineWrapCompartment, value);
      }
    },
    setZoom: (zoom) => {
      const view = getView();
      if (view) {
        applyZoom(view, fontSizeCompartment, zoom);
      }
    },
    findNext: (query, caseSensitive) => {
      const view = getView();
      const found = editorFindNext(view, query, caseSensitive);
      if (found) {
        updateCursor();
      }
      return found;
    },
    findPrevious: (query, caseSensitive) => {
      const view = getView();
      const found = editorFindPrevious(view, query, caseSensitive);
      if (found) {
        updateCursor();
      }
      return found;
    },
    replaceCurrent: (query, replacement, caseSensitive) =>
      editorReplaceCurrent(getView(), query, replacement, caseSensitive),
    replaceAndFindNext: (query, replacement, caseSensitive) => {
      const view = getView();
      const found = editorReplaceAndFindNext(view, query, replacement, caseSensitive);
      if (found) {
        updateCursor();
      }
      return found;
    },
    replaceAll: (query, replacement, caseSensitive) => {
      const count = editorReplaceAll(getView(), query, replacement, caseSensitive);
      if (count > 0) {
        updateCursor();
      }
      return count;
    },
    setSearchQuery: (query, caseSensitive) =>
      editorSetSearchQuery(getView(), query, caseSensitive, searchHighlightCompartment),
    getMatchInfo: (query, caseSensitive) =>
      editorGetMatchInfo(getView(), query, caseSensitive),
    goToLine: (line) => {
      const view = getView();
      return view ? goToLine(view, line, updateCursor) : false;
    },
  };
}

export { applyWrap, applyZoom };
