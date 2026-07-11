/**
 * Editor host / action / query / capability contracts for the M0 foundations
 * series. M0.2 routes commands through a pane-aware workbench runtime; M0.4
 * exposes grouped domain actions/queries on the host. The flat
 * `EditorCommandRunner` remains a thin adapter for handlers and find/replace.
 *
 * SpecOps-native naming only — do not expose raw CodeMirror `EditorView`
 * outside `app/src/lib/editor/`.
 */

/** Identity of a mounted editor host within a window/route workbench. */
export type EditorHostIdentity = {
  paneId: string;
  documentId: string | null;
  /** Monotonic generation; late register/unregister with a lower generation is rejected (M0.2). */
  generation: number;
};

/** Result of registering a host with the workbench runtime (M0.2). */
export type EditorHostRegistration = {
  identity: EditorHostIdentity;
  /** Idempotent unregister; must not clear a newer active host. */
  unregister: () => void;
};

/**
 * How commands report that they cannot run.
 * Prefer this over silently no-oping once M0.2 wires capability checks.
 */
export type EditorActionFailureReason =
  | "no-active-host"
  | "unavailable"
  | "disabled"
  | "stale-host";

export type EditorActionResult =
  | { ok: true }
  | { ok: false; reason: EditorActionFailureReason };

export type EditorQueryResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: EditorActionFailureReason };

/**
 * Named editor actions. Core set matches today's runner; later milestones
 * extend this union without growing a prop/facade chain.
 */
export type EditorActionName =
  | "undo"
  | "redo"
  | "indent"
  | "outdent"
  | "moveLineUp"
  | "moveLineDown"
  | "duplicateLine"
  | "joinLines"
  | "setWrap"
  | "setZoom"
  | "findNext"
  | "findPrevious"
  | "replaceCurrent"
  | "replaceAndFindNext"
  | "replaceAll"
  | "setSearchQuery"
  | "goToLine"
  // Occurrence-selection actions (M2):
  | "selectNextOccurrence"
  | "selectAllOccurrences"
  | "skipOccurrence"
  | "undoOccurrence"
  // Extension points (implemented in later milestones):
  | "fold"
  | "unfold"
  | "foldAll"
  | "unfoldAll"
  | "completeWord"
  | "insertSnippet"
  | "jumpToHeading"
  | "toggleBookmark"
  | "nextBookmark"
  | "previousBookmark";

export type MatchInfo = {
  total: number;
  current: number;
};

export type EditorSelectionSnapshot = {
  from: number;
  to: number;
  head: number;
  empty: boolean;
};

/** History domain — undo/redo. */
export type EditorHistoryActions = {
  undo: () => EditorActionResult;
  redo: () => EditorActionResult;
};

/**
 * Selection-domain edits (indent, outdent) and occurrence-selection actions.
 * Occurrence actions return `{ ok: false, reason: "disabled" }` when there is
 * no further match (e.g. wrap exhausted); handlers surface the message via the
 * status bar without firing a noisy notification.
 */
export type EditorSelectionActions = {
  indent: () => EditorActionResult;
  outdent: () => EditorActionResult;
  /** Select the next occurrence of the current selection (seeds from word at cursor when empty). */
  selectNextOccurrence: () => EditorActionResult;
  /** Select all occurrences of the currently selected text. */
  selectAllOccurrences: () => EditorActionResult;
  /** Advance the main selection to the next match without adding a range. */
  skipOccurrence: () => EditorActionResult;
  /** Remove the most recently added secondary occurrence selection. */
  undoOccurrence: () => EditorActionResult;
};

/** Line-oriented transforms. */
export type EditorLineActions = {
  moveLineUp: () => EditorActionResult;
  moveLineDown: () => EditorActionResult;
  duplicateLine: () => EditorActionResult;
  joinLines: () => EditorActionResult;
};

/** Cursor/navigation actions. */
export type EditorNavigationActions = {
  goToLine: (line: number) => EditorActionResult;
};

/** Find/replace and search-highlight configuration. */
export type EditorSearchActions = {
  findNext: (query: string, caseSensitive: boolean) => EditorActionResult;
  findPrevious: (query: string, caseSensitive: boolean) => EditorActionResult;
  replaceCurrent: (
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ) => EditorActionResult;
  replaceAndFindNext: (
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ) => EditorActionResult;
  replaceAll: (
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ) => EditorQueryResult<number>;
  setSearchQuery: (query: string, caseSensitive: boolean) => EditorActionResult;
};

/** View chrome (wrap / zoom). */
export type EditorViewActions = {
  setWrap: (value: boolean) => EditorActionResult;
  setZoom: (zoom: number) => EditorActionResult;
};

/**
 * Grouped imperative actions on the active pane host (M0.4).
 * Editor-local CodeMirror keymaps win while focus is inside the editor;
 * app-level actions run only when routing permits (see appShellKeyRouting).
 */
export type EditorDomainActions = {
  history: EditorHistoryActions;
  selection: EditorSelectionActions;
  lines: EditorLineActions;
  navigation: EditorNavigationActions;
  search: EditorSearchActions;
  view: EditorViewActions;
};

export type EditorHistoryQueries = {
  canUndo: () => EditorQueryResult<boolean>;
  canRedo: () => EditorQueryResult<boolean>;
};

export type EditorSelectionQueries = {
  getSelection: () => EditorQueryResult<EditorSelectionSnapshot>;
};

export type EditorDocumentQueries = {
  getDocumentContent: () => EditorQueryResult<string>;
};

export type EditorSearchQueries = {
  getMatchInfo: (query: string, caseSensitive: boolean) => EditorQueryResult<MatchInfo>;
};

/** Grouped read-only queries against the active pane host (M0.4). */
export type EditorDomainQueries = {
  history: EditorHistoryQueries;
  selection: EditorSelectionQueries;
  document: EditorDocumentQueries;
  search: EditorSearchQueries;
};

/**
 * Flat action bag kept for contract smoke tests and capability enumeration.
 * Prefer `EditorDomainActions` on the live host.
 */
export type EditorActions = {
  undo: () => EditorActionResult;
  redo: () => EditorActionResult;
  indent: () => EditorActionResult;
  outdent: () => EditorActionResult;
  moveLineUp: () => EditorActionResult;
  moveLineDown: () => EditorActionResult;
  duplicateLine: () => EditorActionResult;
  joinLines: () => EditorActionResult;
  setWrap: (value: boolean) => EditorActionResult;
  setZoom: (zoom: number) => EditorActionResult;
  findNext: (query: string, caseSensitive: boolean) => EditorActionResult;
  findPrevious: (query: string, caseSensitive: boolean) => EditorActionResult;
  replaceCurrent: (
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ) => EditorActionResult;
  replaceAndFindNext: (
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ) => EditorActionResult;
  replaceAll: (
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ) => EditorQueryResult<number>;
  setSearchQuery: (query: string, caseSensitive: boolean) => EditorActionResult;
  goToLine: (line: number) => EditorActionResult;
};

/** Flat query bag (compat); prefer `EditorDomainQueries` on the live host. */
export type EditorQueries = {
  getMatchInfo: (query: string, caseSensitive: boolean) => EditorQueryResult<MatchInfo>;
  getSelection: () => EditorQueryResult<EditorSelectionSnapshot>;
  getDocumentContent: () => EditorQueryResult<string>;
  canUndo: () => EditorQueryResult<boolean>;
  canRedo: () => EditorQueryResult<boolean>;
};

/** Availability of an action or app command against the active host. */
export type EditorCapabilityState = "available" | "disabled" | "unavailable";

export type EditorCommandCapability = {
  state: EditorCapabilityState;
  /** Optional human-readable reason when not available. */
  reason?: string;
};

/**
 * Host surface consumed by the M0.2 workbench runtime.
 * Callers outside `app/src/lib/editor/` must not receive a raw editor view.
 */
export type EditorHost = {
  identity: EditorHostIdentity;
  actions: EditorDomainActions;
  queries: EditorDomainQueries;
  capability: (action: EditorActionName) => EditorCommandCapability;
  focus: () => void;
};

/**
 * Compatibility facade used by command handlers and FindReplacePanel.
 * Prefer `EditorHost` domain actions/queries; `editorHostToCommandRunner` adapts.
 * Kept as an adapter shape only for this refactor series (no persisted-data compat).
 */
export type EditorCommandRunner = {
  undo: () => void;
  redo: () => void;
  indent: () => void;
  outdent: () => void;
  moveLineUp: () => void;
  moveLineDown: () => void;
  duplicateLine: () => void;
  joinLines: () => void;
  selectNextOccurrence: () => boolean;
  selectAllOccurrences: () => boolean;
  skipOccurrence: () => boolean;
  undoOccurrence: () => boolean;
  setWrap: (value: boolean) => void;
  setZoom: (zoom: number) => void;
  findNext: (query: string, caseSensitive: boolean) => boolean;
  findPrevious: (query: string, caseSensitive: boolean) => boolean;
  replaceCurrent: (
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ) => boolean;
  replaceAndFindNext: (
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ) => boolean;
  replaceAll: (
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ) => number;
  setSearchQuery: (query: string, caseSensitive: boolean) => void;
  getMatchInfo: (query: string, caseSensitive: boolean) => MatchInfo;
  goToLine: (line: number) => boolean;
};

/**
 * M2 binding decision (resolved in M2.2):
 * `Cmd/Ctrl+D` was reassigned from `edit.duplicateLine` to
 * `edit.selectNextOccurrence`. Duplicate line received `Cmd/Ctrl+Alt+D`
 * (Cmd+Shift+D was unavailable — owned by `view.toggleDiffPreview`).
 */
export const SELECT_NEXT_OCCURRENCE_BINDING_DECISION = {
  chord: { mac: "Cmd+D", windows: "Ctrl+D" },
  previousOwner: "edit.duplicateLine",
  owner: "edit.selectNextOccurrence",
  duplicateLineNewDefault: { mac: "Cmd+Alt+D", windows: "Ctrl+Alt+D" },
  duplicateLineNeedsNewDefault: false,
} as const;
