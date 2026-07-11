/**
 * Grouped editor domain actions/queries over a live CodeMirror view.
 * Raw `EditorView` stays inside the editor layer; handlers use the flat runner adapter.
 */
import { EditorSelection, type Compartment } from "@codemirror/state";
import { indentLess, indentMore, redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type {
  EditorActionName,
  EditorActionResult,
  EditorCommandCapability,
  EditorDomainActions,
  EditorDomainQueries,
  EditorQueryResult,
  MatchInfo,
} from "../types/editor";
import { applyWrap, applyZoom } from "./editorExtensions";
import { buildLineOpTransaction, type LineOpKind } from "./editorLineTransactions";
import {
  editorFindNext,
  editorFindPrevious,
  editorGetMatchInfo,
  editorReplaceAll,
  editorReplaceAndFindNext,
  editorReplaceCurrent,
  editorSetSearchQuery,
} from "./editorSearchOps";
import {
  selectAllOccurrencesOp,
  selectNextOccurrenceOp,
  skipOccurrenceOp,
  undoOccurrenceOp,
} from "./editorSelectionOps";

export type CreateEditorDomainApisOptions = {
  getView: () => EditorView | undefined;
  lineWrapCompartment: Compartment;
  fontSizeCompartment: Compartment;
  searchHighlightCompartment: Compartment;
  onStatusMessage: (message: string) => void;
  updateCursor: () => void;
};

function ok(): EditorActionResult {
  return { ok: true };
}

function unavailable(): EditorActionResult {
  return { ok: false, reason: "unavailable" };
}

function disabled(): EditorActionResult {
  return { ok: false, reason: "disabled" };
}

function dispatchLineOp(
  view: EditorView,
  kind: LineOpKind,
  onStatusMessage: (message: string) => void,
): void {
  const result = buildLineOpTransaction(view.state, kind);
  if (result.changes.length > 0) {
    view.dispatch({
      changes: result.changes,
      selection: result.selection,
      userEvent: "input",
    });
  }
  if (result.message) {
    onStatusMessage(result.message);
  }
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

const CORE_ACTIONS = new Set<EditorActionName>([
  "undo",
  "redo",
  "indent",
  "outdent",
  "selectNextOccurrence",
  "selectAllOccurrences",
  "skipOccurrence",
  "undoOccurrence",
  "moveLineUp",
  "moveLineDown",
  "duplicateLine",
  "joinLines",
  "setWrap",
  "setZoom",
  "findNext",
  "findPrevious",
  "replaceCurrent",
  "replaceAndFindNext",
  "replaceAll",
  "setSearchQuery",
  "goToLine",
]);

export type EditorDomainApis = {
  actions: EditorDomainActions;
  queries: EditorDomainQueries;
  capability: (action: EditorActionName) => EditorCommandCapability;
};

export function createEditorDomainApis(
  opts: CreateEditorDomainApisOptions,
): EditorDomainApis {
  const {
    getView,
    lineWrapCompartment,
    fontSizeCompartment,
    searchHighlightCompartment,
    onStatusMessage,
    updateCursor,
  } = opts;

  const actions: EditorDomainActions = {
    history: {
      undo: () => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        undo(view);
        return ok();
      },
      redo: () => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        redo(view);
        return ok();
      },
    },
    selection: {
      indent: () => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        indentMore(view);
        return ok();
      },
      outdent: () => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        indentLess(view);
        return ok();
      },
      selectNextOccurrence: () => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        const result = selectNextOccurrenceOp(view);
        if (result.ok) {
          updateCursor();
          return ok();
        }
        if (result.message) {
          onStatusMessage(result.message);
        }
        return disabled();
      },
      selectAllOccurrences: () => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        const result = selectAllOccurrencesOp(view);
        if (result.ok) {
          updateCursor();
          return ok();
        }
        if (result.message) {
          onStatusMessage(result.message);
        }
        return disabled();
      },
      skipOccurrence: () => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        const result = skipOccurrenceOp(view);
        if (result.ok) {
          updateCursor();
          return ok();
        }
        if (result.message) {
          onStatusMessage(result.message);
        }
        return disabled();
      },
      undoOccurrence: () => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        const result = undoOccurrenceOp(view);
        if (result.ok) {
          updateCursor();
          return ok();
        }
        if (result.message) {
          onStatusMessage(result.message);
        }
        return disabled();
      },
    },
    lines: {
      moveLineUp: () => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        dispatchLineOp(view, "moveUp", onStatusMessage);
        return ok();
      },
      moveLineDown: () => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        dispatchLineOp(view, "moveDown", onStatusMessage);
        return ok();
      },
      duplicateLine: () => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        dispatchLineOp(view, "duplicate", onStatusMessage);
        return ok();
      },
      joinLines: () => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        dispatchLineOp(view, "join", onStatusMessage);
        return ok();
      },
    },
    navigation: {
      goToLine: (line) => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        return goToLine(view, line, updateCursor) ? ok() : disabled();
      },
    },
    search: {
      findNext: (query, caseSensitive) => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        const found = editorFindNext(view, query, caseSensitive);
        if (found) {
          updateCursor();
        }
        return found ? ok() : disabled();
      },
      findPrevious: (query, caseSensitive) => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        const found = editorFindPrevious(view, query, caseSensitive);
        if (found) {
          updateCursor();
        }
        return found ? ok() : disabled();
      },
      replaceCurrent: (query, replacement, caseSensitive) => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        return editorReplaceCurrent(view, query, replacement, caseSensitive)
          ? ok()
          : disabled();
      },
      replaceAndFindNext: (query, replacement, caseSensitive) => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        const found = editorReplaceAndFindNext(
          view,
          query,
          replacement,
          caseSensitive,
        );
        if (found) {
          updateCursor();
        }
        return found ? ok() : disabled();
      },
      replaceAll: (query, replacement, caseSensitive): EditorQueryResult<number> => {
        const view = getView();
        if (!view) {
          return { ok: false, reason: "unavailable" };
        }
        const count = editorReplaceAll(view, query, replacement, caseSensitive);
        if (count > 0) {
          updateCursor();
        }
        return { ok: true, value: count };
      },
      setSearchQuery: (query, caseSensitive) => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        editorSetSearchQuery(
          view,
          query,
          caseSensitive,
          searchHighlightCompartment,
        );
        return ok();
      },
    },
    view: {
      setWrap: (value) => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        applyWrap(view, lineWrapCompartment, value);
        return ok();
      },
      setZoom: (zoom) => {
        const view = getView();
        if (!view) {
          return unavailable();
        }
        applyZoom(view, fontSizeCompartment, zoom);
        return ok();
      },
    },
  };

  const queries: EditorDomainQueries = {
    history: {
      canUndo: (): EditorQueryResult<boolean> => {
        if (!getView()) {
          return { ok: false, reason: "unavailable" };
        }
        return { ok: true, value: true };
      },
      canRedo: (): EditorQueryResult<boolean> => {
        if (!getView()) {
          return { ok: false, reason: "unavailable" };
        }
        return { ok: true, value: true };
      },
    },
    selection: {
      getSelection: () => {
        const view = getView();
        if (!view) {
          return { ok: false, reason: "unavailable" };
        }
        const range = view.state.selection.main;
        return {
          ok: true,
          value: {
            from: range.from,
            to: range.to,
            head: range.head,
            empty: range.empty,
          },
        };
      },
    },
    document: {
      getDocumentContent: () => {
        const view = getView();
        if (!view) {
          return { ok: false, reason: "unavailable" };
        }
        return { ok: true, value: view.state.doc.toString() };
      },
    },
    search: {
      getMatchInfo: (query, caseSensitive): EditorQueryResult<MatchInfo> => {
        if (!getView()) {
          return { ok: false, reason: "unavailable" };
        }
        return {
          ok: true,
          value: editorGetMatchInfo(getView(), query, caseSensitive),
        };
      },
    },
  };

  function capability(action: EditorActionName): EditorCommandCapability {
    if (!getView()) {
      return { state: "unavailable", reason: "Editor view is not mounted." };
    }
    if (!CORE_ACTIONS.has(action)) {
      return { state: "unavailable", reason: "Action is not implemented yet." };
    }
    return { state: "available" };
  }

  return { actions, queries, capability };
}
