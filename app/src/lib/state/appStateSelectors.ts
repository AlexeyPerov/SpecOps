import { derived } from "svelte/store";
import type {
  AppDomainState,
  AppSettingsState,
  ContextSnapshot,
  DocumentState,
  SessionState,
} from "../domain/contracts";
import { appState } from "./appState";
import {
  allContextSnapshots,
  collectAllOpenDocumentIds,
  getActiveContextSnapshot,
} from "./appState/contextHelpers";
import { externalFileWatcherSyncKey } from "../services/appShellHelpers";

export const appContexts = derived(appState, ($state) => $state.contexts);
export const appSettings = derived(appState, ($state) => $state.settings);
export const appEditor = derived(appState, ($state) => $state.editor);
export const appTheme = derived(appState, ($state) => $state.theme);
export const appRecentFiles = derived(appState, ($state) => $state.recentFiles);
export const appActivityRailWidthPx = derived(appState, ($state) => $state.activityRailWidthPx);

export const appActiveContextId = derived(appContexts, ($contexts) => $contexts.activeContextId);

let lastActiveContextInput: {
  contextsRef: AppDomainState["contexts"];
  activeContextId: string;
} | null = null;
let lastActiveContextOutput: ContextSnapshot | null = null;

/** Active context snapshot with referential stability when contexts are unchanged. */
export const appActiveContext = derived(appState, ($state) => {
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
});

export const appActiveSession = derived(appActiveContext, ($ctx) => $ctx.session);
export const appActiveDocuments = derived(appActiveContext, ($ctx) => $ctx.documents);

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
export const appOpenDocumentIds = derived(appState, ($state) => {
  const next = collectAllOpenDocumentIds($state);
  if (setsEqual(lastOpenDocIdsOutput, next)) {
    return lastOpenDocIdsOutput;
  }
  lastOpenDocIdsOutput = next;
  return next;
});

type WatcherStructuralSlice = {
  session: SessionState;
  documents: DocumentState[];
};

let lastExternalWatcherWatchFlag: boolean | null = null;
let lastExternalWatcherSlices: WatcherStructuralSlice[] | null = null;
let lastExternalWatcherKeyOutput: string | null = null;

function documentWatchIdentityEqual(a: DocumentState[], b: DocumentState[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!;
    const right = b[index]!;
    if (left.id !== right.id || left.filePath !== right.filePath) {
      return false;
    }
  }
  return true;
}

function watcherStructuralSlices(state: AppDomainState): WatcherStructuralSlice[] {
  return allContextSnapshots(state).map((entry) => ({
    session: entry.snapshot.session,
    documents: entry.snapshot.documents,
  }));
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
    // Content edits replace the documents array but keep the session ref.
    if (left.session !== right.session) {
      return false;
    }
    if (!documentWatchIdentityEqual(left.documents, right.documents)) {
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
    chatHttp: settings.chatHttp,
    gitIntegration: settings.gitIntegration,
    logSettings: settings.logSettings,
    chatModes: settings.chatModes,
    markdownSnippets: settings.markdownSnippets,
    providerSettings: settings.providerSettings,
    providerModelCatalogs: settings.providerModelCatalogs,
    commandBindingOverrides: settings.commandBindingOverrides,
    fontSettings: settings.fontSettings,
    soundSettings: settings.soundSettings,
    osNotificationSettings: settings.osNotificationSettings,
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
