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

let lastOpenDocIdsInput: AppDomainState["contexts"] | null = null;
let lastOpenDocIdsOutput: Set<string> = new Set();

/** Open document ids across all contexts; stable Set ref when contexts unchanged. */
export const appOpenDocumentIds = derived(appState, ($state) => {
  const contexts = $state.contexts;
  if (lastOpenDocIdsInput === contexts) {
    return lastOpenDocIdsOutput;
  }
  lastOpenDocIdsInput = contexts;
  lastOpenDocIdsOutput = collectAllOpenDocumentIds($state);
  return lastOpenDocIdsOutput;
});

let lastExternalWatcherContextsRef: AppDomainState["contexts"] | null = null;
let lastExternalWatcherWatchFlag: boolean | null = null;
let lastExternalWatcherKeyOutput: string | null = null;

/** Stable external file-watcher sync key; skips recompute on cursor-only churn. */
export const appExternalWatcherSyncKey = derived(appState, ($state) => {
  const contexts = $state.contexts;
  const watchFlag = $state.settings.externalFiles.watchExternalChanges;
  if (
    lastExternalWatcherContextsRef === contexts &&
    lastExternalWatcherWatchFlag === watchFlag &&
    lastExternalWatcherKeyOutput !== null
  ) {
    return lastExternalWatcherKeyOutput;
  }
  const key = externalFileWatcherSyncKey($state);
  lastExternalWatcherContextsRef = contexts;
  lastExternalWatcherWatchFlag = watchFlag;
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
  lastOpenDocIdsInput = null;
  lastOpenDocIdsOutput = new Set();
  lastRecencyInput = null;
  lastRecencyOutput = EMPTY_RECENCY;
  lastExternalWatcherContextsRef = null;
  lastExternalWatcherWatchFlag = null;
  lastExternalWatcherKeyOutput = null;
}
