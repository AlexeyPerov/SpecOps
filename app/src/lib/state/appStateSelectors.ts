import { derived } from "svelte/store";
import type {
  AppDomainState,
  AppSettingsState,
  ContextSnapshot,
  DocumentState,
  SessionState,
} from "../domain/contracts";
import { allTabs, isFileTab } from "../domain/contracts";
import { appState } from "./appState";
import {
  allContextSnapshots,
  collectAllOpenDocumentIds,
  getActiveContextSnapshot,
} from "./appState/contextHelpers";
import { externalFileWatcherSyncKey } from "../services/appShellHelpers";
import { stableDerived } from "./stableStore";

/**
 * Object-valued slices of `appState`, republished with strict (`===`) equality.
 *
 * Svelte's `safe_not_equal` treats every object as changed on every
 * `appState.update()`, so a plain `derived(appState, ($s) => $s.contexts)`
 * re-notifies every consumer on every keystroke / cursor move — even though
 * the `contexts` reference is unchanged. These stable variants suppress that
 * spurious fan-out (P03-08-20). Pair with the referential-stability selectors
 * below (which preserve object references when nothing changed).
 */
export const appContexts = stableDerived(derived(appState, ($state) => $state.contexts));
export const appSettings = stableDerived(derived(appState, ($state) => $state.settings));
export const appEditor = stableDerived(derived(appState, ($state) => $state.editor));
export const appTheme = stableDerived(derived(appState, ($state) => $state.theme));
export const appRecentFiles = stableDerived(derived(appState, ($state) => $state.recentFiles));
export const appActivityRailWidthPx = stableDerived(
  derived(appState, ($state) => $state.activityRailWidthPx),
);

export const appActiveContextId = stableDerived(
  derived(appContexts, ($contexts) => $contexts.activeContextId),
);

let lastActiveContextInput: {
  contextsRef: AppDomainState["contexts"];
  activeContextId: string;
} | null = null;
let lastActiveContextOutput: ContextSnapshot | null = null;

/** Active context snapshot with referential stability when contexts are unchanged. */
export const appActiveContext = stableDerived(
  derived(appState, ($state) => {
    const contexts = $state.contexts;
    const activeContextId = contexts.activeContextId;
    if (
      lastActiveContextInput &&
      lastActiveContextInput.contextsRef === contexts &&
      lastActiveContextInput.activeContextId === activeContextId &&
      lastActiveContextOutput
    ) {
      return lastActiveContextOutput;
    }
    const snapshot = getActiveContextSnapshot($state);
    lastActiveContextInput = { contextsRef: contexts, activeContextId };
    lastActiveContextOutput = snapshot;
    return snapshot;
  }),
);

export const appActiveSession = stableDerived(
  derived(appActiveContext, ($ctx) => $ctx.session),
);
export const appActiveDocuments = stableDerived(
  derived(appActiveContext, ($ctx) => $ctx.documents),
);

let lastOpenDocIdsOutput: Set<string> = new Set();

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

/**
 * Open document ids across all contexts.
 * Reuses the previous Set when membership is unchanged so content-only edits
 * (which replace `state.contexts`) do not thrash session-cache retain.
 */
export const appOpenDocumentIds = stableDerived(
  derived(appState, ($state) => {
    const next = collectAllOpenDocumentIds($state);
    if (setsEqual(lastOpenDocIdsOutput, next)) {
      return lastOpenDocIdsOutput;
    }
    lastOpenDocIdsOutput = next;
    return next;
  }),
);

type WatcherStructuralSlice = {
  /**
   * Sorted list of `filePath`s that the file tabs in this context's editor
   * layout resolve to (via the context's documents). This is exactly the
   * per-context contribution to the watched path set, so comparing these
   * strings across emits is a precise gate for "the watched set changed"
   * without re-walking every tab (P03-08-24e).
   */
  watchedPaths: string[];
};

let lastExternalWatcherWatchFlag: boolean | null = null;
let lastExternalWatcherSlices: WatcherStructuralSlice[] | null = null;
let lastExternalWatcherKeyOutput: string | null = null;

function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function watcherStructuralSlices(state: AppDomainState): WatcherStructuralSlice[] {
  return allContextSnapshots(state).map((entry) => {
    const documents = entry.snapshot.documents;
    const documentById = new Map(documents.map((documentState) => [documentState.id, documentState]));
    const paths = new Set<string>();
    for (const tab of allTabs(entry.snapshot.session.editorLayout)) {
      if (!isFileTab(tab)) {
        continue;
      }
      const documentState = documentById.get(tab.documentId);
      if (documentState?.filePath) {
        paths.add(documentState.filePath);
      }
    }
    // Sort so the comparison is order-independent (the iteration order of
    // `allContextSnapshots` is stable, but sorting removes any doubt).
    return { watchedPaths: [...paths].sort() };
  });
}

function watcherStructuralEqual(
  previous: WatcherStructuralSlice[] | null,
  next: WatcherStructuralSlice[],
): boolean {
  if (!previous || previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index]!;
    const right = next[index]!;
    // P03-08-24e: compare the resolved watched path sets directly. A tab
    // switch within a workspace (or a cursor move that replaces the session
    // object) leaves this set unchanged but used to flip the session
    // reference, forcing a full `externalFileWatcherSyncKey` re-walk of every
    // tab in every context. (`allContextSnapshots` returns contexts in a
    // stable order, so index alignment is reliable.)
    if (!stringArraysEqual(left.watchedPaths, right.watchedPaths)) {
      return false;
    }
  }
  return true;
}

/**
 * Stable external file-watcher sync key.
 * Gates on watch-flag + per-context session identity and document id/path
 * (not `contexts` referential identity), so keystrokes do not re-walk tabs.
 */
export const appExternalWatcherSyncKey = derived(appState, ($state) => {
  const watchFlag = $state.settings.externalFiles.watchExternalChanges;
  const slices = watcherStructuralSlices($state);
  if (
    lastExternalWatcherWatchFlag === watchFlag &&
    watcherStructuralEqual(lastExternalWatcherSlices, slices) &&
    lastExternalWatcherKeyOutput !== null
  ) {
    return lastExternalWatcherKeyOutput;
  }
  const key = externalFileWatcherSyncKey($state);
  lastExternalWatcherWatchFlag = watchFlag;
  lastExternalWatcherSlices = slices;
  lastExternalWatcherKeyOutput = key;
  return key;
});

export type QuickOpenRecencyInputs = {
  openPaths: string[];
  recentPaths: readonly string[];
};

const EMPTY_RECENCY: QuickOpenRecencyInputs = { openPaths: [], recentPaths: [] };

let lastRecencyInput: {
  sessionRef: SessionState;
  documentsRef: DocumentState[];
  recentFilesRef: readonly string[];
} | null = null;
let lastRecencyOutput: QuickOpenRecencyInputs = EMPTY_RECENCY;

/**
 * Stable quick-open recency inputs keyed by session/documents/recentFiles refs.
 * Avoids allocating a fresh `{ openPaths, recentPaths }` on unrelated appState
 * mutations (e.g. cursor moves).
 */
export function deriveQuickOpenRecencyInputs(
  session: SessionState,
  documents: DocumentState[],
  recentFiles: readonly string[],
  collectOpenPaths: (session: SessionState, documents: DocumentState[]) => string[],
): QuickOpenRecencyInputs {
  if (
    lastRecencyInput &&
    lastRecencyInput.sessionRef === session &&
    lastRecencyInput.documentsRef === documents &&
    lastRecencyInput.recentFilesRef === recentFiles
  ) {
    return lastRecencyOutput;
  }
  const openPaths = collectOpenPaths(session, documents);
  lastRecencyInput = { sessionRef: session, documentsRef: documents, recentFilesRef: recentFiles };
  lastRecencyOutput = { openPaths, recentPaths: recentFiles };
  return lastRecencyOutput;
}

/** Fields persisted by syncSettingsPersistenceEffect — excludes cursor position. */
export function settingsPersistenceFingerprint(state: AppDomainState): string {
  const settings: AppSettingsState = state.settings;
  const editor = state.editor;
  return JSON.stringify({
    wrapLines: editor.wrapLines,
    zoomPercent: editor.zoomPercent,
    externalFiles: settings.externalFiles,
    decoratePlaintextSymbols: settings.decoratePlaintextSymbols,
    showMinimap: settings.showMinimap,
    showFoldGutter: settings.showFoldGutter,
    autoClosePairs: settings.autoClosePairs,
    autoSuggest: settings.autoSuggest,
    defaultMarkdownViewMode: settings.defaultMarkdownViewMode,
    restrictFilesToContext: settings.restrictFilesToContext,
    opencode: settings.opencode,
    gitIntegration: settings.gitIntegration,
    logSettings: settings.logSettings,
    markdownSnippets: settings.markdownSnippets,
    commandBindingOverrides: settings.commandBindingOverrides,
    fontSettings: settings.fontSettings,
    soundSettings: settings.soundSettings,
    osNotificationSettings: settings.osNotificationSettings,
    showHiddenFiles: settings.showHiddenFiles,
  });
}

export function resetAppStateSelectorsForTests(): void {
  lastActiveContextInput = null;
  lastActiveContextOutput = null;
  lastOpenDocIdsOutput = new Set();
  lastRecencyInput = null;
  lastRecencyOutput = EMPTY_RECENCY;
  lastExternalWatcherSlices = null;
  lastExternalWatcherWatchFlag = null;
  lastExternalWatcherKeyOutput = null;
}
