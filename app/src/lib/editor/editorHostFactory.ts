/**
 * Builds an `EditorHost` (typed actions/queries) from a command-runner facade
 * and a focus callback. Raw `EditorView` stays inside this module.
 */
import type { EditorView } from "@codemirror/view";
import type {
  EditorActionName,
  EditorActionResult,
  EditorCommandCapability,
  EditorCommandRunner,
  EditorHost,
  EditorHostIdentity,
  EditorQueryResult,
  MatchInfo,
} from "../types/editor";
import {
  createEditorCommandRunner,
  type CreateEditorCommandRunnerOptions,
} from "./editorCommandRunner";

export type CreateEditorHostOptions = CreateEditorCommandRunnerOptions & {
  identity: EditorHostIdentity;
  focus: () => void;
};

function ok(): EditorActionResult {
  return { ok: true };
}

function unavailable(): EditorActionResult {
  return { ok: false, reason: "unavailable" };
}

function wrapVoid(
  getView: () => EditorView | undefined,
  run: () => void,
): () => EditorActionResult {
  return () => {
    if (!getView()) {
      return unavailable();
    }
    run();
    return ok();
  };
}

function wrapBool(
  getView: () => EditorView | undefined,
  run: () => boolean,
): () => EditorActionResult {
  return () => {
    if (!getView()) {
      return unavailable();
    }
    return run() ? ok() : { ok: false, reason: "disabled" };
  };
}

/**
 * Compatibility adapter: active-host actions/queries → flat runner shape
 * used by FindReplacePanel and command handlers during the M0.2 migration.
 */
export function editorHostToCommandRunner(host: EditorHost): EditorCommandRunner {
  return {
    undo: () => {
      host.actions.undo();
    },
    redo: () => {
      host.actions.redo();
    },
    indent: () => {
      host.actions.indent();
    },
    outdent: () => {
      host.actions.outdent();
    },
    moveLineUp: () => {
      host.actions.moveLineUp();
    },
    moveLineDown: () => {
      host.actions.moveLineDown();
    },
    duplicateLine: () => {
      host.actions.duplicateLine();
    },
    joinLines: () => {
      host.actions.joinLines();
    },
    setWrap: (value) => {
      host.actions.setWrap(value);
    },
    setZoom: (zoom) => {
      host.actions.setZoom(zoom);
    },
    findNext: (query, caseSensitive) => host.actions.findNext(query, caseSensitive).ok,
    findPrevious: (query, caseSensitive) =>
      host.actions.findPrevious(query, caseSensitive).ok,
    replaceCurrent: (query, replacement, caseSensitive) =>
      host.actions.replaceCurrent(query, replacement, caseSensitive).ok,
    replaceAndFindNext: (query, replacement, caseSensitive) =>
      host.actions.replaceAndFindNext(query, replacement, caseSensitive).ok,
    replaceAll: (query, replacement, caseSensitive) => {
      const result = host.actions.replaceAll(query, replacement, caseSensitive);
      return result.ok ? result.value : 0;
    },
    setSearchQuery: (query, caseSensitive) => {
      host.actions.setSearchQuery(query, caseSensitive);
    },
    getMatchInfo: (query, caseSensitive) => {
      const result = host.queries.getMatchInfo(query, caseSensitive);
      return result.ok ? result.value : { total: 0, current: 0 };
    },
    goToLine: (line) => host.actions.goToLine(line).ok,
  };
}

export function createEditorHost(opts: CreateEditorHostOptions): EditorHost {
  const { identity, focus, getView, ...runnerOpts } = opts;
  const runner = createEditorCommandRunner({ getView, ...runnerOpts });

  const actions = {
    undo: wrapVoid(getView, runner.undo),
    redo: wrapVoid(getView, runner.redo),
    indent: wrapVoid(getView, runner.indent),
    outdent: wrapVoid(getView, runner.outdent),
    moveLineUp: wrapVoid(getView, runner.moveLineUp),
    moveLineDown: wrapVoid(getView, runner.moveLineDown),
    duplicateLine: wrapVoid(getView, runner.duplicateLine),
    joinLines: wrapVoid(getView, runner.joinLines),
    setWrap: (value: boolean) => wrapVoid(getView, () => runner.setWrap(value))(),
    setZoom: (zoom: number) => wrapVoid(getView, () => runner.setZoom(zoom))(),
    findNext: (query: string, caseSensitive: boolean) =>
      wrapBool(getView, () => runner.findNext(query, caseSensitive))(),
    findPrevious: (query: string, caseSensitive: boolean) =>
      wrapBool(getView, () => runner.findPrevious(query, caseSensitive))(),
    replaceCurrent: (query: string, replacement: string, caseSensitive: boolean) =>
      wrapBool(getView, () => runner.replaceCurrent(query, replacement, caseSensitive))(),
    replaceAndFindNext: (
      query: string,
      replacement: string,
      caseSensitive: boolean,
    ) =>
      wrapBool(getView, () =>
        runner.replaceAndFindNext(query, replacement, caseSensitive),
      )(),
    replaceAll: (
      query: string,
      replacement: string,
      caseSensitive: boolean,
    ): EditorQueryResult<number> => {
      if (!getView()) {
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, value: runner.replaceAll(query, replacement, caseSensitive) };
    },
    setSearchQuery: (query: string, caseSensitive: boolean) =>
      wrapVoid(getView, () => runner.setSearchQuery(query, caseSensitive))(),
    goToLine: (line: number) => wrapBool(getView, () => runner.goToLine(line))(),
  };

  const queries = {
    getMatchInfo: (
      query: string,
      caseSensitive: boolean,
    ): EditorQueryResult<MatchInfo> => {
      if (!getView()) {
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, value: runner.getMatchInfo(query, caseSensitive) };
    },
    getSelection: (): EditorQueryResult<{
      from: number;
      to: number;
      head: number;
      empty: boolean;
    }> => {
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
    getDocumentContent: (): EditorQueryResult<string> => {
      const view = getView();
      if (!view) {
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, value: view.state.doc.toString() };
    },
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
  };

  const coreActions = new Set<EditorActionName>([
    "undo",
    "redo",
    "indent",
    "outdent",
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

  function capability(action: EditorActionName): EditorCommandCapability {
    if (!getView()) {
      return { state: "unavailable", reason: "Editor view is not mounted." };
    }
    if (!coreActions.has(action)) {
      return { state: "unavailable", reason: "Action is not implemented yet." };
    }
    return { state: "available" };
  }

  return {
    identity,
    actions,
    queries,
    capability,
    focus,
  };
}
