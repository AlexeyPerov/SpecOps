import { writable } from "svelte/store";
import type {
  AppDomainState,
  AppSettingsState,
  AppThemeState,
  ContextId,
  ContextSnapshot,
  DebugProviderSettings,
  DiskFingerprint,
  DocumentState,
  DocumentIdentity,
  ExternalFilesSettings,
  TabState,
  WorkspaceEntry,
  WindowBounds,
  WindowSessionSnapshot,
} from "../domain/contracts";
import {
  defaultDebugProviderSettings,
  normalizeDebugProviderSettings,
} from "../ai/providers/debugProviderSettings";
import { inferEditorLanguage } from "../editor/editorLanguage";
import { normalizePathSync } from "../services/diskFingerprint";
import { bumpRecentFile } from "../services/recentFiles";
import { syncRecentFiles } from "../services/recentFilesSync";
import {
  defaultThemeFile,
  loadThemeFile,
  saveThemeFile,
  type ActiveThemeRef,
  type CustomThemeRecord,
  type ThemeFileV1,
} from "../services/themeStore";
import type { BuiltinThemeId } from "../styles/themeTokens";
import {
  applyBuiltinTheme,
  applyCustomTheme,
  DEFAULT_BUILTIN_THEME,
  getBuiltinThemeMode,
  resolveBuiltinTokens,
  snapshotThemeTokens,
  type ThemeTokenKey,
  type ThemeTokens,
} from "../styles/themeTokens";

const defaultExternalFilesSettings: ExternalFilesSettings = {
  watchExternalChanges: true,
  autoReloadCleanFiles: true,
  checkOnWindowFocus: true,
  checkOnTabActivate: true,
};

const defaultSettings: AppSettingsState = {
  statusBarVisible: true,
  externalFiles: defaultExternalFilesSettings,
  decoratePlaintextSymbols: true,
  hideActivityRailWhenNotepadOnly: true,
  debugProvider: defaultDebugProviderSettings,
};

const defaultThemeState: AppThemeState = {
  activeTheme: defaultThemeFile.activeTheme,
  customThemes: defaultThemeFile.customThemes,
};

let themeSaveTimer: ReturnType<typeof setTimeout> | null = null;
let themeSaveErrorNotifier: ((message: string) => void) | null = null;

const THEME_TOKEN_SAVE_DEBOUNCE_MS = 300;
const THEME_SAVE_ERROR_MESSAGE =
  "Failed to save theme. Changes kept in memory; will retry on next change.";

/** Clears debounce timer between unit tests. */
export function resetThemePersistenceForTests(): void {
  if (themeSaveTimer) {
    clearTimeout(themeSaveTimer);
    themeSaveTimer = null;
  }
}

export function setThemeSaveErrorNotifier(notifier: (message: string) => void): void {
  themeSaveErrorNotifier = notifier;
}

function toThemeFile(theme: AppThemeState): ThemeFileV1 {
  return {
    version: 1,
    activeTheme: theme.activeTheme,
    customThemes: theme.customThemes,
  };
}

async function persistThemeNow(theme: AppThemeState): Promise<void> {
  try {
    await saveThemeFile(toThemeFile(theme));
  } catch {
    themeSaveErrorNotifier?.(THEME_SAVE_ERROR_MESSAGE);
  }
}

function persistThemeImmediate(theme: AppThemeState): void {
  if (themeSaveTimer) {
    clearTimeout(themeSaveTimer);
    themeSaveTimer = null;
  }
  void persistThemeNow(theme);
}

function scheduleDebouncedThemeSave(theme: AppThemeState): void {
  if (themeSaveTimer) {
    clearTimeout(themeSaveTimer);
  }
  themeSaveTimer = setTimeout(() => {
    themeSaveTimer = null;
    void persistThemeNow(theme);
  }, THEME_TOKEN_SAVE_DEBOUNCE_MS);
}

function findCustomTheme(theme: AppThemeState, id: string): CustomThemeRecord | undefined {
  return theme.customThemes.find((entry) => entry.id === id);
}

function fallbackBuiltinForTheme(theme: AppThemeState): BuiltinThemeId {
  if (theme.activeTheme.kind === "builtin") {
    return theme.activeTheme.id;
  }
  const custom = findCustomTheme(theme, theme.activeTheme.id);
  if (!custom) {
    return DEFAULT_BUILTIN_THEME;
  }
  return custom.baseMode === "dark" ? "dark-amber" : "light-blue";
}

function baseModeForTheme(theme: AppThemeState): "dark" | "light" {
  if (theme.activeTheme.kind === "builtin") {
    return getBuiltinThemeMode(theme.activeTheme.id);
  }
  return findCustomTheme(theme, theme.activeTheme.id)?.baseMode ?? "dark";
}

function applyThemeState(theme: AppThemeState): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  if (theme.activeTheme.kind === "builtin") {
    applyBuiltinTheme(theme.activeTheme.id, root);
    return;
  }

  const custom = findCustomTheme(theme, theme.activeTheme.id);
  if (custom) {
    applyCustomTheme(custom, root);
    return;
  }

  applyBuiltinTheme(DEFAULT_BUILTIN_THEME, root);
}

function nextCustomThemeName(customThemes: CustomThemeRecord[]): string {
  const usedIndexes = new Set<number>();
  for (const custom of customThemes) {
    const match = /^Custom (\d+)$/.exec(custom.name.trim());
    if (match) {
      usedIndexes.add(Number(match[1]));
    }
  }
  let index = 1;
  while (usedIndexes.has(index)) {
    index += 1;
  }
  return `Custom ${index}`;
}

function snapshotCurrentThemeTokens(theme: AppThemeState): ThemeTokens {
  const fallbackBuiltin = fallbackBuiltinForTheme(theme);
  if (typeof document !== "undefined") {
    try {
      return snapshotThemeTokens(document.documentElement, fallbackBuiltin);
    } catch {
      // jsdom or pre-paint environment
    }
  }
  return resolveBuiltinTokens(fallbackBuiltin);
}

function createCustomThemeFromCurrent(theme: AppThemeState): AppThemeState {
  const baseMode = baseModeForTheme(theme);
  const tokens = snapshotCurrentThemeTokens(theme);
  const id = crypto.randomUUID();
  const custom: CustomThemeRecord = {
    id,
    name: nextCustomThemeName(theme.customThemes),
    baseMode,
    tokens,
  };

  const nextTheme: AppThemeState = {
    activeTheme: { kind: "custom", id },
    customThemes: [...theme.customThemes, custom],
  };
  applyThemeState(nextTheme);
  return nextTheme;
}
let docCounter = 1;
let tabCounter = 1;
let workspaceCounter = 0;
const NOTEPAD_CONTEXT_ID: ContextId = "notepad";

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function inferLanguage(path: string | null): string {
  return inferEditorLanguage(path);
}

function deriveUntitledTitle(content: string): string {
  const firstLine = (content.split(/\r?\n/, 1)[0] ?? "").trim();
  if (!firstLine) {
    return "Untitled";
  }
  return Array.from(firstLine).slice(0, 64).join("");
}

function buildDocument(identity: DocumentIdentity, content: string, title: string): DocumentState {
  return {
    id: identity.id,
    filePath: identity.filePath,
    title,
    content,
    savedContent: content,
    isDirty: false,
    language: inferLanguage(identity.filePath),
    encoding: "utf-8",
    lineEnding: content.includes("\r\n") ? "crlf" : "lf",
    diskFingerprint: null,
    dismissedFingerprint: null,
    fileMissing: false,
    scrollTop: 0,
  };
}

function normalizeDocument(documentState: DocumentState): DocumentState {
  return {
    ...documentState,
    diskFingerprint: documentState.diskFingerprint ?? null,
    dismissedFingerprint: documentState.dismissedFingerprint ?? null,
    fileMissing: documentState.fileMissing ?? false,
    scrollTop: documentState.scrollTop ?? 0,
  };
}

function cloneContextSnapshot(snapshot: ContextSnapshot): ContextSnapshot {
  return {
    documents: snapshot.documents.map(normalizeDocument),
    session: {
      ...snapshot.session,
      openTabs: snapshot.session.openTabs.map((tab) => ({ ...tab })),
      windowBounds: snapshot.session.windowBounds ?? null,
    },
  };
}

function normalizeWorkspaceEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    rootPath: normalizePathSync(entry.rootPath),
    snapshot: cloneContextSnapshot(entry.snapshot),
  }));
}

function getContextSnapshotById(state: AppDomainState, contextId: ContextId): ContextSnapshot | null {
  if (contextId === NOTEPAD_CONTEXT_ID) {
    return state.contexts.notepad;
  }
  const workspace = state.contexts.workspaces.find((entry) => entry.id === contextId);
  return workspace?.snapshot ?? null;
}

function getActiveContextSnapshot(state: AppDomainState): ContextSnapshot {
  return (
    getContextSnapshotById(state, state.contexts.activeContextId) ?? state.contexts.notepad
  );
}

function withActiveContextApplied(state: AppDomainState): AppDomainState {
  const activeContext = getActiveContextSnapshot(state);
  return {
    ...state,
    documents: activeContext.documents,
    session: activeContext.session,
  };
}

function syncLegacyFieldsIntoActiveContext(state: AppDomainState): AppDomainState {
  const activeSnapshot: ContextSnapshot = {
    documents: state.documents,
    session: state.session,
  };
  if (state.contexts.activeContextId === NOTEPAD_CONTEXT_ID) {
    return {
      ...state,
      contexts: {
        ...state.contexts,
        notepad: activeSnapshot,
      },
    };
  }
  return {
    ...state,
    contexts: {
      ...state.contexts,
      workspaces: state.contexts.workspaces.map((workspace) =>
        workspace.id === state.contexts.activeContextId
          ? { ...workspace, snapshot: activeSnapshot }
          : workspace,
      ),
    },
  };
}

function reindexWorkspaceCounter(workspaces: WorkspaceEntry[]): void {
  workspaceCounter = Math.max(
    0,
    ...workspaces.map((workspace) => Number(workspace.id.replace("ws-", "")) || 0),
  );
}

function nextWorkspaceId(): ContextId {
  workspaceCounter += 1;
  return `ws-${workspaceCounter}`;
}

function fallbackContextSnapshot(lastActiveWindowId: string): ContextSnapshot {
  docCounter += 1;
  tabCounter += 1;
  const documentId = `doc-${docCounter}`;
  const tabId = `tab-${tabCounter}`;
  return {
    documents: [buildDocument({ id: documentId, filePath: null }, "", "Untitled")],
    session: {
      selectedTabId: tabId,
      openTabs: [{ id: tabId, documentId, pinned: false }],
      lastActiveWindowId,
      windowBounds: null,
    },
  };
}

function ensureContextSnapshotHasTab(snapshot: ContextSnapshot): ContextSnapshot {
  if (snapshot.session.openTabs.length > 0) {
    return snapshot;
  }
  return fallbackContextSnapshot(snapshot.session.lastActiveWindowId);
}

export function findWorkspaceByPath(
  workspaces: WorkspaceEntry[],
  rootPath: string,
): WorkspaceEntry | null {
  const normalized = normalizePathSync(rootPath);
  return workspaces.find((workspace) => normalizePathSync(workspace.rootPath) === normalized) ?? null;
}

function findDocumentByPath(state: AppDomainState, filePath: string): DocumentState | undefined {
  const normalized = normalizePathSync(filePath);
  return state.documents.find(
    (documentState) =>
      documentState.filePath !== null &&
      normalizePathSync(documentState.filePath) === normalized,
  );
}

function findDocumentByPathInContext(
  context: ContextSnapshot,
  filePath: string,
): DocumentState | undefined {
  const normalized = normalizePathSync(filePath);
  return context.documents.find(
    (documentState) =>
      documentState.filePath !== null &&
      normalizePathSync(documentState.filePath) === normalized,
  );
}

function reopenTabForDocument(state: AppDomainState, documentId: string): AppDomainState {
  tabCounter += 1;
  const tabId = `tab-${tabCounter}`;
  return {
    ...state,
    session: {
      ...state.session,
      openTabs: [...state.session.openTabs, { id: tabId, documentId, pinned: false }],
      selectedTabId: tabId,
    },
  };
}

function moveTab(tabs: TabState[], fromIndex: number, toIndex: number): TabState[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= tabs.length ||
    toIndex >= tabs.length ||
    fromIndex === toIndex
  ) {
    return tabs;
  }
  const next = [...tabs];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) {
    return tabs;
  }
  next.splice(toIndex, 0, moved);
  return next;
}

function tabIdsToCloseOtherThan(
  openTabs: TabState[],
  contextTabId: string,
): string[] {
  return openTabs
    .filter((tab) => tab.id !== contextTabId && !tab.pinned)
    .map((tab) => tab.id);
}

function tabIdsToCloseToRightOf(
  openTabs: TabState[],
  contextTabId: string,
): string[] {
  const contextIndex = openTabs.findIndex((tab) => tab.id === contextTabId);
  if (contextIndex < 0) {
    return [];
  }
  return openTabs
    .slice(contextIndex + 1)
    .filter((tab) => !tab.pinned)
    .map((tab) => tab.id);
}

function missingTabIdsToClose(
  openTabs: TabState[],
  documents: DocumentState[],
): string[] {
  const missingByDocumentId = new Map(
    documents.map((documentState) => [documentState.id, documentState.fileMissing]),
  );
  return openTabs
    .filter((tab) => !tab.pinned && missingByDocumentId.get(tab.documentId) === true)
    .map((tab) => tab.id);
}

function nextSelectedTabAfterBulkClose(
  previousTabs: TabState[],
  remainingTabs: TabState[],
  previousSelectedTabId: string | null,
  preferredTabId: string | null = null,
): string | null {
  if (preferredTabId && remainingTabs.some((tab) => tab.id === preferredTabId)) {
    return preferredTabId;
  }
  if (!previousSelectedTabId) {
    return remainingTabs[0]?.id ?? null;
  }
  if (remainingTabs.some((tab) => tab.id === previousSelectedTabId)) {
    return previousSelectedTabId;
  }

  const selectedIndex = previousTabs.findIndex((tab) => tab.id === previousSelectedTabId);
  if (selectedIndex >= 0) {
    for (let idx = selectedIndex - 1; idx >= 0; idx -= 1) {
      const candidateId = previousTabs[idx]?.id;
      if (candidateId && remainingTabs.some((tab) => tab.id === candidateId)) {
        return candidateId;
      }
    }
  }
  return remainingTabs[0]?.id ?? null;
}

function closeTabsForce(state: AppDomainState, tabIds: string[], preferredTabId: string | null): AppDomainState {
  if (tabIds.length === 0) {
    return state;
  }
  const idsToClose = new Set(tabIds);
  const filteredTabs = state.session.openTabs.filter((tab) => !idsToClose.has(tab.id));
  if (filteredTabs.length === state.session.openTabs.length) {
    return state;
  }
  if (filteredTabs.length === 0) {
    docCounter += 1;
    tabCounter += 1;
    const docId = `doc-${docCounter}`;
    const tabId = `tab-${tabCounter}`;
    const newDocument = buildDocument(
      { id: docId, filePath: null },
      "",
      "Untitled",
    );
    return {
      ...state,
      documents: [...state.documents, newDocument],
      session: {
        ...state.session,
        openTabs: [{ id: tabId, documentId: docId, pinned: false }],
        selectedTabId: tabId,
      },
    };
  }

  return {
    ...state,
    session: {
      ...state.session,
      openTabs: filteredTabs,
      selectedTabId: nextSelectedTabAfterBulkClose(
        state.session.openTabs,
        filteredTabs,
        state.session.selectedTabId,
        preferredTabId,
      ),
    },
  };
}

const initialState: AppDomainState = {
  contexts: {
    activeContextId: NOTEPAD_CONTEXT_ID,
    notepad: {
      documents: [buildDocument({ id: "doc-1", filePath: null }, "", "Untitled")],
      session: {
        selectedTabId: "tab-1",
        openTabs: [{ id: "tab-1", documentId: "doc-1", pinned: false }],
        lastActiveWindowId: "main",
        windowBounds: null,
      },
    },
    workspaces: [],
  },
  documents: [buildDocument({ id: "doc-1", filePath: null }, "", "Untitled")],
  session: {
    selectedTabId: "tab-1",
    openTabs: [{ id: "tab-1", documentId: "doc-1", pinned: false }],
    lastActiveWindowId: "main",
    windowBounds: null,
  },
  settings: defaultSettings,
  theme: defaultThemeState,
  recentFiles: [],
  editor: {
    cursorLine: 1,
    cursorColumn: 1,
    zoomPercent: 100,
    wrapLines: true,
    findReplaceOpen: false,
    goToOpen: false,
    previewMode: "editor",
    projectPanelCollapsed: false,
  },
};

function createStateStore() {
  const { subscribe, update: rawUpdate, set } = writable<AppDomainState>(initialState);

  function update(mutator: (state: AppDomainState) => AppDomainState): void {
    rawUpdate((state) => {
      const base = withActiveContextApplied(syncLegacyFieldsIntoActiveContext(state));
      const next = mutator(base);
      return withActiveContextApplied(syncLegacyFieldsIntoActiveContext(next));
    });
  }

  function selectTabInternal(state: AppDomainState, tabId: string): AppDomainState {
    if (!state.session.openTabs.some((tab) => tab.id === tabId)) {
      return state;
    }
    return {
      ...state,
      session: { ...state.session, selectedTabId: tabId },
    };
  }

  function toCurrentWindowSnapshot(state: AppDomainState): WindowSessionSnapshot {
    const synced = syncLegacyFieldsIntoActiveContext(state);
    return {
      activeContextId: synced.contexts.activeContextId,
      notepad: cloneContextSnapshot(synced.contexts.notepad),
      workspaces: normalizeWorkspaceEntries(synced.contexts.workspaces),
      editorPreferences: {
        zoomPercent: synced.editor.zoomPercent,
        wrapLines: synced.editor.wrapLines,
        projectPanelCollapsed: synced.editor.projectPanelCollapsed,
      },
    };
  }

  return {
    subscribe,
    getSnapshot() {
      let snapshot = initialState;
      const un = subscribe((state) => {
        snapshot = state;
      });
      un();
      return snapshot;
    },
    setActiveTheme(ref: ActiveThemeRef) {
      update((state) => {
        const theme: AppThemeState = { ...state.theme, activeTheme: ref };
        applyThemeState(theme);
        persistThemeImmediate(theme);
        return { ...state, theme };
      });
    },
    /** @deprecated Use `setActiveTheme({ kind: "builtin", id })`. */
    setTheme(id: BuiltinThemeId) {
      this.setActiveTheme({ kind: "builtin", id });
    },
    cycleTheme() {
      update((state) => {
        const currentMode = baseModeForTheme(state.theme);
        const nextId: BuiltinThemeId = currentMode === "dark" ? "light-blue" : "dark-amber";
        const theme: AppThemeState = {
          ...state.theme,
          activeTheme: { kind: "builtin", id: nextId },
        };
        applyThemeState(theme);
        persistThemeImmediate(theme);
        return { ...state, theme };
      });
    },
    createCustomTheme() {
      update((state) => {
        const theme = createCustomThemeFromCurrent(state.theme);
        persistThemeImmediate(theme);
        return { ...state, theme };
      });
    },
    renameCustomTheme(id: string, name: string) {
      const trimmed = name.trim();
      if (!trimmed) {
        return;
      }
      update((state) => {
        const customThemes = state.theme.customThemes.map((custom) =>
          custom.id === id ? { ...custom, name: trimmed } : custom,
        );
        const theme: AppThemeState = { ...state.theme, customThemes };
        persistThemeImmediate(theme);
        return { ...state, theme };
      });
    },
    deleteCustomTheme(id: string) {
      update((state) => {
        const customThemes = state.theme.customThemes.filter((custom) => custom.id !== id);
        const wasActive = state.theme.activeTheme.kind === "custom" && state.theme.activeTheme.id === id;
        const activeTheme: ActiveThemeRef = wasActive
          ? { kind: "builtin", id: DEFAULT_BUILTIN_THEME }
          : state.theme.activeTheme;
        const theme: AppThemeState = { activeTheme, customThemes };
        applyThemeState(theme);
        persistThemeImmediate(theme);
        return { ...state, theme };
      });
    },
    updateCustomThemeToken(id: string, key: ThemeTokenKey, value: string) {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      update((state) => {
        const customThemes = state.theme.customThemes.map((custom) => {
          if (custom.id !== id) {
            return custom;
          }
          const tokens = { ...custom.tokens, [key]: trimmed };
          if (key === "accent-color") {
            tokens["color-accent"] = trimmed;
          } else if (key === "color-accent") {
            tokens["accent-color"] = trimmed;
          }
          return { ...custom, tokens };
        });
        const theme: AppThemeState = { ...state.theme, customThemes };
        if (state.theme.activeTheme.kind === "custom" && state.theme.activeTheme.id === id) {
          applyThemeState(theme);
        }
        scheduleDebouncedThemeSave(theme);
        return { ...state, theme };
      });
    },
    async loadTheme(): Promise<void> {
      const file = await loadThemeFile();
      const theme: AppThemeState = {
        activeTheme: file.activeTheme,
        customThemes: file.customThemes,
      };
      set({ ...this.getSnapshot(), theme });
      applyThemeState(theme);
    },
    initializeTheme() {
      applyThemeState(this.getSnapshot().theme);
    },
    resetAppState() {
      docCounter = 1;
      tabCounter = 1;
      workspaceCounter = 0;
      set(initialState);
      applyThemeState(initialState.theme);
    },
    applyWindowSession(snapshot: WindowSessionSnapshot, recentFiles: string[] = []) {
      const normalizedNotepad = ensureContextSnapshotHasTab(cloneContextSnapshot(snapshot.notepad));
      const normalizedWorkspaces = normalizeWorkspaceEntries(snapshot.workspaces).map((workspace) => ({
        ...workspace,
        snapshot: ensureContextSnapshotHasTab(workspace.snapshot),
      }));
      const activeContextId =
        snapshot.activeContextId === NOTEPAD_CONTEXT_ID ||
        normalizedWorkspaces.some((workspace) => workspace.id === snapshot.activeContextId)
          ? snapshot.activeContextId
          : NOTEPAD_CONTEXT_ID;
      const contexts = {
        activeContextId,
        notepad: normalizedNotepad,
        workspaces: normalizedWorkspaces,
      };
      const activeContextSnapshot =
        activeContextId === NOTEPAD_CONTEXT_ID
          ? contexts.notepad
          : contexts.workspaces.find((workspace) => workspace.id === activeContextId)?.snapshot ??
            contexts.notepad;
      docCounter = Math.max(
        1,
        ...[
          ...contexts.notepad.documents,
          ...contexts.workspaces.flatMap((workspace) => workspace.snapshot.documents),
        ].map((documentState) =>
          Number(documentState.id.replace("doc-", "")) || 1,
        ),
      );
      tabCounter = Math.max(
        1,
        ...[
          ...contexts.notepad.session.openTabs,
          ...contexts.workspaces.flatMap((workspace) => workspace.snapshot.session.openTabs),
        ].map((tab) =>
          Number(tab.id.replace("tab-", "")) || 1,
        ),
      );
      reindexWorkspaceCounter(contexts.workspaces);
      const preservedSettings = this.getSnapshot().settings;
      const preservedTheme = this.getSnapshot().theme;
      set({
        contexts,
        documents: activeContextSnapshot.documents,
        session: activeContextSnapshot.session,
        settings: preservedSettings,
        theme: preservedTheme,
        recentFiles,
        editor: {
          ...initialState.editor,
          ...snapshot.editorPreferences,
          findReplaceOpen: false,
          goToOpen: false,
          previewMode: "editor",
        },
      });
      applyThemeState(preservedTheme);
    },
    getWindowSessionSnapshot(): WindowSessionSnapshot {
      return toCurrentWindowSnapshot(this.getSnapshot());
    },
    getActiveContext() {
      const state = this.getSnapshot();
      if (state.contexts.activeContextId === NOTEPAD_CONTEXT_ID) {
        return {
          id: NOTEPAD_CONTEXT_ID,
          kind: "notepad" as const,
          snapshot: getActiveContextSnapshot(state),
        };
      }
      const workspace =
        state.contexts.workspaces.find((entry) => entry.id === state.contexts.activeContextId) ?? null;
      return {
        id: state.contexts.activeContextId,
        kind: "workspace" as const,
        rootPath: workspace?.rootPath ?? null,
        snapshot: getActiveContextSnapshot(state),
      };
    },
    getActiveDocuments() {
      return this.getSnapshot().documents;
    },
    getActiveSession() {
      return this.getSnapshot().session;
    },
    isNotepadActive() {
      return this.getSnapshot().contexts.activeContextId === NOTEPAD_CONTEXT_ID;
    },
    getWorkspaceRoot(contextId?: ContextId): string | null {
      const state = this.getSnapshot();
      const targetId = contextId ?? state.contexts.activeContextId;
      if (targetId === NOTEPAD_CONTEXT_ID) {
        return null;
      }
      return state.contexts.workspaces.find((workspace) => workspace.id === targetId)?.rootPath ?? null;
    },
    switchContext(contextId: ContextId): boolean {
      let switched = false;
      update((state) => {
        const synced = syncLegacyFieldsIntoActiveContext(state);
        const exists =
          contextId === NOTEPAD_CONTEXT_ID ||
          synced.contexts.workspaces.some((workspace) => workspace.id === contextId);
        if (!exists || synced.contexts.activeContextId === contextId) {
          return synced;
        }
        switched = true;
        return withActiveContextApplied({
          ...synced,
          contexts: {
            ...synced.contexts,
            activeContextId: contextId,
          },
          editor: {
            ...synced.editor,
            findReplaceOpen: false,
            goToOpen: false,
            previewMode: "editor",
          },
        });
      });
      return switched;
    },
    addWorkspace(rootPath: string): ContextId | null {
      let createdId: ContextId | null = null;
      update((state) => {
        const synced = syncLegacyFieldsIntoActiveContext(state);
        const normalizedRoot = normalizePathSync(rootPath);
        const duplicate = findWorkspaceByPath(synced.contexts.workspaces, normalizedRoot);
        if (duplicate) {
          return synced;
        }
        const workspaceId = nextWorkspaceId();
        createdId = workspaceId;
        const workspaceSnapshot = fallbackContextSnapshot(synced.session.lastActiveWindowId);
        return withActiveContextApplied({
          ...synced,
          contexts: {
            ...synced.contexts,
            activeContextId: workspaceId,
            workspaces: [
              ...synced.contexts.workspaces,
              {
                id: workspaceId,
                rootPath: normalizedRoot,
                snapshot: workspaceSnapshot,
              },
            ],
          },
          editor: {
            ...synced.editor,
            findReplaceOpen: false,
            goToOpen: false,
            previewMode: "editor",
          },
        });
      });
      return createdId;
    },
    closeWorkspace(
      workspaceId: ContextId,
      options?: {
        resolveAction?: (dirtyDocuments: DocumentState[]) => "save-all" | "discard-all" | "cancel";
        saveAllDirtyDocuments?: (dirtyDocuments: DocumentState[]) => void;
      },
    ): boolean {
      let closed = false;
      update((state) => {
        const synced = syncLegacyFieldsIntoActiveContext(state);
        const targetWorkspace = synced.contexts.workspaces.find((workspace) => workspace.id === workspaceId);
        if (!targetWorkspace) {
          return synced;
        }
        const dirtyDocuments = targetWorkspace.snapshot.documents.filter((documentState) => documentState.isDirty);
        let action: "save-all" | "discard-all" | "cancel" = "discard-all";
        if (dirtyDocuments.length > 0) {
          action = options?.resolveAction?.(dirtyDocuments) ?? "cancel";
        }
        if (action === "cancel") {
          return synced;
        }
        if (action === "save-all") {
          if (!options?.saveAllDirtyDocuments) {
            return synced;
          }
          options.saveAllDirtyDocuments(dirtyDocuments);
        }
        closed = true;
        return withActiveContextApplied({
          ...synced,
          contexts: {
            ...synced.contexts,
            activeContextId: NOTEPAD_CONTEXT_ID,
            workspaces: synced.contexts.workspaces.filter((workspace) => workspace.id !== workspaceId),
          },
          editor: {
            ...synced.editor,
            findReplaceOpen: false,
            goToOpen: false,
            previewMode: "editor",
          },
        });
      });
      return closed;
    },
    replaceRecentFiles(recentFiles: string[]) {
      update((state) => ({ ...state, recentFiles }));
    },
    touchRecentFile(filePath: string) {
      const recentFiles = bumpRecentFile(this.getSnapshot().recentFiles, filePath);
      this.replaceRecentFiles(recentFiles);
      void syncRecentFiles(recentFiles);
    },
    clearRecentFiles() {
      this.replaceRecentFiles([]);
      void syncRecentFiles([]);
    },
    removeRecentFile(filePath: string) {
      const recentFiles = this.getSnapshot().recentFiles.filter((entry) => entry !== filePath);
      this.replaceRecentFiles(recentFiles);
      void syncRecentFiles(recentFiles);
    },
    createTab() {
      update((state) => {
        docCounter += 1;
        tabCounter += 1;
        const id = `doc-${docCounter}`;
        const newDocument = buildDocument(
          { id, filePath: null },
          "",
          "Untitled",
        );
        const tabId = `tab-${tabCounter}`;
        const nextState = {
          ...state,
          documents: [...state.documents, newDocument],
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, { id: tabId, documentId: id, pinned: false }],
            selectedTabId: tabId,
          },
        };
        return nextState;
      });
    },
    selectTab(tabId: string) {
      update((state) => selectTabInternal(state, tabId));
    },
    selectOrReopenTabForDocument(documentId: string) {
      update((state) => {
        const existingTab = state.session.openTabs.find(
          (tab) => tab.documentId === documentId,
        );
        if (existingTab) {
          return selectTabInternal(state, existingTab.id);
        }
        return reopenTabForDocument(state, documentId);
      });
    },
    findDocumentIdByPath(filePath: string): string | null {
      const snapshot = this.getSnapshot();
      const inActive = findDocumentByPath(snapshot, filePath);
      if (inActive) {
        return inActive.id;
      }
      const inNotepad = findDocumentByPathInContext(snapshot.contexts.notepad, filePath);
      if (inNotepad) {
        return inNotepad.id;
      }
      for (const workspace of snapshot.contexts.workspaces) {
        const inWorkspace = findDocumentByPathInContext(workspace.snapshot, filePath);
        if (inWorkspace) {
          return inWorkspace.id;
        }
      }
      return null;
    },
    reorderTabs(fromIndex: number, toIndex: number) {
      update((state) => {
        const openTabs = moveTab(state.session.openTabs, fromIndex, toIndex);
        if (openTabs === state.session.openTabs) {
          return state;
        }
        return {
          ...state,
          session: {
            ...state.session,
            openTabs,
          },
        };
      });
    },
    closeTab(tabId: string) {
      update((state) => {
        const openTabs = state.session.openTabs;
        if (openTabs.length <= 1) {
          return state;
        }
        const idx = openTabs.findIndex((tab) => tab.id === tabId);
        if (idx < 0) {
          return state;
        }
        const filtered = openTabs.filter((tab) => tab.id !== tabId);
        const selectedTabId =
          state.session.selectedTabId === tabId
            ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
            : state.session.selectedTabId;
        return {
          ...state,
          session: {
            ...state.session,
            openTabs: filtered,
            selectedTabId,
          },
        };
      });
    },
    closeTabForce(tabId: string) {
      update((state) => {
        const openTabs = state.session.openTabs;
        if (openTabs.length === 0) {
          return state;
        }
        const idx = openTabs.findIndex((tab) => tab.id === tabId);
        if (idx < 0) {
          return state;
        }
        const filtered = openTabs.filter((tab) => tab.id !== tabId);
        if (filtered.length === 0) {
          docCounter += 1;
          tabCounter += 1;
          const docId = `doc-${docCounter}`;
          const tabIdNew = `tab-${tabCounter}`;
          const newDocument = buildDocument(
            { id: docId, filePath: null },
            "",
            "Untitled",
          );
          return {
            ...state,
            documents: [...state.documents, newDocument],
            session: {
              ...state.session,
              openTabs: [{ id: tabIdNew, documentId: docId, pinned: false }],
              selectedTabId: tabIdNew,
            },
          };
        }
        const selectedTabId =
          state.session.selectedTabId === tabId
            ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
            : state.session.selectedTabId;
        return {
          ...state,
          session: {
            ...state.session,
            openTabs: filtered,
            selectedTabId,
          },
        };
      });
    },
    closeTabWithPrompt(tabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = this.getSnapshot();
      const targetTab = snapshot.session.openTabs.find((tab) => tab.id === tabId);
      if (!targetTab) {
        return false;
      }
      const targetDocument = snapshot.documents.find((documentState) => documentState.id === targetTab.documentId);
      if (targetDocument?.isDirty && !confirm(`Close ${targetDocument.title} without saving?`)) {
        return false;
      }
      this.closeTabForce(tabId);
      return true;
    },
    closeOtherTabs(contextTabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = this.getSnapshot();
      if (!snapshot.session.openTabs.some((tab) => tab.id === contextTabId)) {
        return false;
      }
      const tabIds = tabIdsToCloseOtherThan(snapshot.session.openTabs, contextTabId);
      if (tabIds.length === 0) {
        return false;
      }

      for (const tabId of tabIds) {
        const tab = snapshot.session.openTabs.find((entry) => entry.id === tabId);
        if (!tab) {
          continue;
        }
        const doc = snapshot.documents.find((documentState) => documentState.id === tab.documentId);
        if (doc?.isDirty && !confirm(`Close ${doc.title} without saving?`)) {
          return false;
        }
      }

      update((state) => closeTabsForce(state, tabIds, contextTabId));
      return true;
    },
    closeTabsToRight(contextTabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = this.getSnapshot();
      const tabIds = tabIdsToCloseToRightOf(snapshot.session.openTabs, contextTabId);
      if (tabIds.length === 0) {
        return false;
      }

      for (const tabId of tabIds) {
        const tab = snapshot.session.openTabs.find((entry) => entry.id === tabId);
        if (!tab) {
          continue;
        }
        const doc = snapshot.documents.find((documentState) => documentState.id === tab.documentId);
        if (doc?.isDirty && !confirm(`Close ${doc.title} without saving?`)) {
          return false;
        }
      }

      update((state) => closeTabsForce(state, tabIds, contextTabId));
      return true;
    },
    closeMissingFileTabs(): boolean {
      const snapshot = this.getSnapshot();
      const tabIds = missingTabIdsToClose(snapshot.session.openTabs, snapshot.documents);
      if (tabIds.length === 0) {
        return false;
      }

      update((state) => closeTabsForce(state, tabIds, null));
      return true;
    },
    openFileInTab(filePath: string, content: string): string {
      let openedDocumentId = "";
      let recentFiles: string[] = [];
      update((state) => {
        recentFiles = bumpRecentFile(state.recentFiles, filePath);
        const duplicate = findDocumentByPath(state, filePath);
        if (duplicate) {
          openedDocumentId = duplicate.id;
          const existingTab = state.session.openTabs.find(
            (tab) => tab.documentId === duplicate.id,
          );
          if (existingTab) {
            return {
              ...selectTabInternal(state, existingTab.id),
              recentFiles,
            };
          }
          return {
            ...reopenTabForDocument(state, duplicate.id),
            recentFiles,
          };
        }

        docCounter += 1;
        tabCounter += 1;
        const docId = `doc-${docCounter}`;
        openedDocumentId = docId;
        const tabId = `tab-${tabCounter}`;
        const documentState = buildDocument(
          { id: docId, filePath },
          content,
          basename(filePath),
        );

        return {
          ...state,
          documents: [...state.documents, documentState],
          recentFiles,
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, { id: tabId, documentId: docId, pinned: false }],
            selectedTabId: tabId,
          },
        };
      });
      syncRecentFiles(recentFiles);
      return openedDocumentId;
    },
    transferActiveTabOut(): { filePath: string | null; content: string; title: string } | null {
      const snapshot = this.getSnapshot();
      const selectedTab = snapshot.session.openTabs.find(
        (tab) => tab.id === snapshot.session.selectedTabId,
      );
      if (!selectedTab) {
        return null;
      }
      const doc = snapshot.documents.find(
        (documentState) => documentState.id === selectedTab.documentId,
      );
      if (!doc) {
        return null;
      }
      this.closeTabForce(selectedTab.id);
      return {
        filePath: doc.filePath,
        content: doc.content,
        title: doc.title,
      };
    },
    openTransferredTab(payload: {
      filePath: string | null;
      content: string;
      title: string;
    }): string | null {
      let documentId: string | null = null;
      update((state) => {
        if (payload.filePath) {
          const duplicate = findDocumentByPath(state, payload.filePath);
          if (duplicate) {
            documentId = duplicate.id;
            const existingTab = state.session.openTabs.find(
              (tab) => tab.documentId === duplicate.id,
            );
            if (existingTab) {
              return selectTabInternal(state, existingTab.id);
            }
            return reopenTabForDocument(state, duplicate.id);
          }
        }
        docCounter += 1;
        tabCounter += 1;
        const docId = `doc-${docCounter}`;
        documentId = docId;
        const tabId = `tab-${tabCounter}`;
        const newDoc = buildDocument(
          { id: docId, filePath: payload.filePath },
          payload.content,
          payload.title,
        );
        return {
          ...state,
          documents: [...state.documents, newDoc],
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, { id: tabId, documentId: docId, pinned: false }],
            selectedTabId: tabId,
          },
        };
      });
      return documentId;
    },
    setDocumentContent(documentId: string, content: string) {
      update((state) => {
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          const lineEnding: "lf" | "crlf" = content.includes("\r\n")
            ? "crlf"
            : "lf";
          return {
            ...documentState,
            content,
            lineEnding,
            isDirty: content !== documentState.savedContent,
          };
        });
        return { ...state, documents };
      });
    },
    refreshUntitledTitle(documentId: string) {
      update((state) => {
        let changed = false;
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId || documentState.filePath !== null) {
            return documentState;
          }
          const title = deriveUntitledTitle(documentState.content);
          if (title === documentState.title) {
            return documentState;
          }
          changed = true;
          return { ...documentState, title };
        });
        if (!changed) {
          return state;
        }
        return { ...state, documents };
      });
    },
    normalizeUntitledTitles() {
      update((state) => {
        let changed = false;
        const documents = state.documents.map((documentState) => {
          if (documentState.filePath !== null) {
            return documentState;
          }
          const title = deriveUntitledTitle(documentState.content);
          if (title === documentState.title) {
            return documentState;
          }
          changed = true;
          return { ...documentState, title };
        });
        if (!changed) {
          return state;
        }
        return { ...state, documents };
      });
    },
    markDocumentSaved(documentId: string, filePath: string | null, content: string) {
      let recentFiles: string[] = [];
      update((state) => {
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            filePath,
            title: filePath ? basename(filePath) : documentState.title,
            savedContent: content,
            content,
            lineEnding: (content.includes("\r\n") ? "crlf" : "lf") as
              | "lf"
              | "crlf",
            isDirty: false,
            language: inferLanguage(filePath),
            fileMissing: false,
          };
        });
        recentFiles =
          filePath === null
            ? state.recentFiles
            : bumpRecentFile(state.recentFiles, filePath);
        return { ...state, documents, recentFiles };
      });
      if (filePath !== null) {
        syncRecentFiles(recentFiles);
      }
    },
    applyDocumentDiskReload(
      documentId: string,
      content: string,
      diskFingerprint: DiskFingerprint,
    ) {
      update((state) => ({
        ...state,
        documents: state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            content,
            savedContent: content,
            isDirty: false,
            diskFingerprint,
            dismissedFingerprint: null,
            fileMissing: false,
            lineEnding: (content.includes("\r\n") ? "crlf" : "lf") as "lf" | "crlf",
          };
        }),
      }));
    },
    applyDocumentKeepLocal(
      documentId: string,
      dismissedFingerprint: DiskFingerprint,
    ) {
      update((state) => ({
        ...state,
        documents: state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            dismissedFingerprint,
          };
        }),
      }));
    },
    setDocumentDiskState(
      documentId: string,
      patch: {
        diskFingerprint: DiskFingerprint | null;
        fileMissing: boolean;
      },
    ) {
      update((state) => ({
        ...state,
        documents: state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            diskFingerprint: patch.diskFingerprint,
            fileMissing: patch.fileMissing,
          };
        }),
      }));
    },
    renameDocument(documentId: string, filePath: string, title: string) {
      let recentFiles: string[] = [];
      update((state) => {
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            filePath,
            title,
            language: inferLanguage(filePath),
          };
        });
        recentFiles = bumpRecentFile(state.recentFiles, filePath);
        return { ...state, documents, recentFiles };
      });
      syncRecentFiles(recentFiles);
    },
    setCursor(line: number, column: number) {
      update((state) => ({
        ...state,
        editor: {
          ...state.editor,
          cursorLine: line,
          cursorColumn: column,
        },
      }));
    },
    setDocumentScrollTop(documentId: string, scrollTop: number) {
      update((state) => {
        let changed = false;
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          if (documentState.scrollTop === scrollTop) {
            return documentState;
          }
          changed = true;
          return { ...documentState, scrollTop };
        });
        if (!changed) {
          return state;
        }
        return { ...state, documents };
      });
    },
    setWindowBounds(windowBounds: WindowBounds | null) {
      update((state) => {
        if (state.session.windowBounds === windowBounds) {
          return state;
        }
        return {
          ...state,
          session: {
            ...state.session,
            windowBounds,
          },
        };
      });
    },
    setZoomPercent(zoomPercent: number) {
      update((state) => ({
        ...state,
        editor: {
          ...state.editor,
          zoomPercent,
        },
      }));
    },
    setPreviewMode(previewMode: "editor" | "markdown" | "diff") {
      update((state) => ({
        ...state,
        editor: { ...state.editor, previewMode },
      }));
    },
    setProjectPanelCollapsed(projectPanelCollapsed: boolean) {
      update((state) => ({
        ...state,
        editor: { ...state.editor, projectPanelCollapsed },
      }));
    },
    toggleFindReplace() {
      update((state) => ({
        ...state,
        editor: {
          ...state.editor,
          findReplaceOpen: !state.editor.findReplaceOpen,
        },
      }));
    },
    setFindReplaceOpen(findReplaceOpen: boolean) {
      update((state) => ({
        ...state,
        editor: { ...state.editor, findReplaceOpen },
      }));
    },
    toggleGoTo() {
      update((state) => ({
        ...state,
        editor: {
          ...state.editor,
          goToOpen: !state.editor.goToOpen,
        },
      }));
    },
    setGoToOpen(goToOpen: boolean) {
      update((state) => ({
        ...state,
        editor: { ...state.editor, goToOpen },
      }));
    },
    toggleWrap() {
      update((state) => ({
        ...state,
        editor: {
          ...state.editor,
          wrapLines: !state.editor.wrapLines,
        },
      }));
    },
    setExternalFilesSettings(externalFiles: ExternalFilesSettings) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          externalFiles,
        },
      }));
    },
    setDecoratePlaintextSymbols(value: boolean) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          decoratePlaintextSymbols: value,
        },
      }));
    },
    setHideActivityRailWhenNotepadOnly(value: boolean) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          hideActivityRailWhenNotepadOnly: value,
        },
      }));
    },
    setDebugProviderSettings(debugProvider: DebugProviderSettings) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          debugProvider: normalizeDebugProviderSettings(debugProvider),
        },
      }));
    },
    updateDebugProviderSettings(patch: Partial<DebugProviderSettings>) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          debugProvider: normalizeDebugProviderSettings({
            ...state.settings.debugProvider,
            ...patch,
          }),
        },
      }));
    },
    applyPersistedSettings(partial: {
      wrapLines?: boolean;
      zoomPercent?: number;
      externalFiles?: ExternalFilesSettings;
      decoratePlaintextSymbols?: boolean;
      hideActivityRailWhenNotepadOnly?: boolean;
      debugProvider?: DebugProviderSettings;
      projectPanelCollapsed?: boolean;
    }) {
      update((state) => {
        let next = state;
        if (typeof partial.wrapLines === "boolean" && partial.wrapLines !== next.editor.wrapLines) {
          next = {
            ...next,
            editor: { ...next.editor, wrapLines: partial.wrapLines },
          };
        }
        if (typeof partial.zoomPercent === "number") {
          next = {
            ...next,
            editor: { ...next.editor, zoomPercent: partial.zoomPercent },
          };
        }
        if (partial.externalFiles) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              externalFiles: partial.externalFiles,
            },
          };
        }
        if (typeof partial.decoratePlaintextSymbols === "boolean") {
          next = {
            ...next,
            settings: {
              ...next.settings,
              decoratePlaintextSymbols: partial.decoratePlaintextSymbols,
            },
          };
        }
        if (typeof partial.hideActivityRailWhenNotepadOnly === "boolean") {
          next = {
            ...next,
            settings: {
              ...next.settings,
              hideActivityRailWhenNotepadOnly: partial.hideActivityRailWhenNotepadOnly,
            },
          };
        }
        if (partial.debugProvider) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              debugProvider: normalizeDebugProviderSettings(partial.debugProvider),
            },
          };
        }
        if (typeof partial.projectPanelCollapsed === "boolean") {
          next = {
            ...next,
            editor: {
              ...next.editor,
              projectPanelCollapsed: partial.projectPanelCollapsed,
            },
          };
        }
        return next;
      });
    },
  };
}

export const appState = createStateStore();
