/**
 * Builds an `EditorHost` (grouped domain actions/queries) from a live view
 * and a focus callback. Raw `EditorView` stays inside this module.
 */
import type {
  EditorCommandRunner,
  EditorHost,
  EditorHostIdentity,
} from "../types/editor";
import {
  createEditorDomainApis,
  type CreateEditorDomainApisOptions,
} from "./editorDomainApis";

export type CreateEditorHostOptions = CreateEditorDomainApisOptions & {
  identity: EditorHostIdentity;
  focus: () => void;
};

/**
 * Compatibility adapter: active-host domain actions/queries → flat runner shape
 * used by FindReplacePanel and command handlers during the M0 migration.
 */
export function editorHostToCommandRunner(host: EditorHost): EditorCommandRunner {
  return {
    undo: () => {
      host.actions.history.undo();
    },
    redo: () => {
      host.actions.history.redo();
    },
    indent: () => {
      host.actions.selection.indent();
    },
    outdent: () => {
      host.actions.selection.outdent();
    },
    moveLineUp: () => {
      host.actions.lines.moveLineUp();
    },
    moveLineDown: () => {
      host.actions.lines.moveLineDown();
    },
    duplicateLine: () => {
      host.actions.lines.duplicateLine();
    },
    joinLines: () => {
      host.actions.lines.joinLines();
    },
    selectNextOccurrence: () => host.actions.selection.selectNextOccurrence().ok,
    selectAllOccurrences: () => host.actions.selection.selectAllOccurrences().ok,
    skipOccurrence: () => host.actions.selection.skipOccurrence().ok,
    undoOccurrence: () => host.actions.selection.undoOccurrence().ok,
    setWrap: (value) => {
      host.actions.view.setWrap(value);
    },
    setZoom: (zoom) => {
      host.actions.view.setZoom(zoom);
    },
    findNext: (query, caseSensitive) =>
      host.actions.search.findNext(query, caseSensitive).ok,
    findPrevious: (query, caseSensitive) =>
      host.actions.search.findPrevious(query, caseSensitive).ok,
    replaceCurrent: (query, replacement, caseSensitive) =>
      host.actions.search.replaceCurrent(query, replacement, caseSensitive).ok,
    replaceAndFindNext: (query, replacement, caseSensitive) =>
      host.actions.search.replaceAndFindNext(query, replacement, caseSensitive)
        .ok,
    replaceAll: (query, replacement, caseSensitive) => {
      const result = host.actions.search.replaceAll(
        query,
        replacement,
        caseSensitive,
      );
      return result.ok ? result.value : 0;
    },
    setSearchQuery: (query, caseSensitive) => {
      host.actions.search.setSearchQuery(query, caseSensitive);
    },
    getMatchInfo: (query, caseSensitive) => {
      const result = host.queries.search.getMatchInfo(query, caseSensitive);
      return result.ok ? result.value : { total: 0, current: 0 };
    },
    goToLine: (line) => host.actions.navigation.goToLine(line).ok,
  };
}

export function createEditorHost(opts: CreateEditorHostOptions): EditorHost {
  const { identity, focus, ...domainOpts } = opts;
  const { actions, queries, capability } = createEditorDomainApis(domainOpts);

  return {
    identity,
    actions,
    queries,
    capability,
    focus,
  };
}
