import { writable } from "svelte/store";
import type {
  AppDomainState,
  AppThemeState,
  ContextId,
  ContextSnapshot,
  DiskFingerprint,
  DocumentState,
  ExternalFilesSettings,
  WorkspaceLayoutState,
  WindowBounds,
  WindowSessionSnapshot,
} from "../domain/contracts";
import {
  createAgentTab,
  createFileTab,
  isAgentTab,
  isFileTab,
  normalizeTabState,
  tabDocumentId,
} from "../domain/contracts";
import { deriveUntitledTitle } from "../services/untitledTitle";
import { isEmptyUnsavedDocument } from "../services/untitledDocument";
import { normalizePathSync } from "../services/diskFingerprint";
import {
  defaultWorkspaceLayout,
  normalizeWorkspaceLayout,
} from "../services/panelLayout";
import { findNextOpenAgentTabAfterClose } from "../services/workspaceAgentSession";
import { bumpRecentFile } from "../services/recentFiles";
import { syncRecentFiles } from "../services/recentFilesSync";
import { loadThemeFile } from "../services/themeStore";
import type { BuiltinThemeId } from "../styles/themeTokens";
import { DEFAULT_BUILTIN_THEME } from "../styles/themeTokens";
import {
  cloneContextSnapshot,
  findDocumentByPath,
  findDocumentByPathInContext,
  findWorkspaceByPath,
  getActiveContextSnapshot,
  getContextSnapshotById,
  nextDocAndTabIds,
  nextTabId,
  nextWorkspaceId,
  normalizeWorkspaceEntries,
  NOTEPAD_CONTEXT_ID,
  reindexIdCountersFromContexts,
  resetIdCounters,
} from "./appState/contextHelpers";
import {
  basename,
  buildDocument,
  buildEmptyUnsavedDocument,
  inferLanguage,
} from "./appState/documentHelpers";
import { createSettingsSlice, defaultSettings } from "./appState/settingsSlice";
import {
  closeTabsForce,
  missingTabIdsToClose,
  moveTab,
  nextSelectedTabAfterBulkClose,
  tabIdsToCloseOtherThan,
  tabIdsToCloseToRightOf,
} from "./appState/tabHelpers";
import {
  applyThemeState,
  baseModeForTheme,
  createCustomThemeFromCurrent,
  defaultThemeState,
  persistThemeImmediate,
  resetThemePersistenceForTests,
  scheduleDebouncedThemeSave,
  setThemeSaveErrorNotifier,
  syncCustomThemeToken,
  type ActiveThemeRef,
  type ThemeTokenKey,
} from "./appState/themeController";

export { findWorkspaceByPath, resetThemePersistenceForTests, setThemeSaveErrorNotifier };

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

function fallbackContextSnapshot(lastActiveWindowId: string): ContextSnapshot {
  const { docId: documentId, tabId } = nextDocAndTabIds();
  return {
    documents: [buildEmptyUnsavedDocument(documentId)],
    session: {
      selectedTabId: tabId,
      openTabs: [createFileTab(tabId, documentId)],
      lastActiveWindowId,
      windowBounds: null,
      lastActiveAgentId: null,
    },
  };
}

function ensureContextSnapshotHasTab(snapshot: ContextSnapshot): ContextSnapshot {
  if (snapshot.session.openTabs.length > 0) {
    return snapshot;
  }
  return fallbackContextSnapshot(snapshot.session.lastActiveWindowId);
}

function reopenTabForDocument(state: AppDomainState, documentId: string): AppDomainState {
  const tabId = nextTabId();
  return {
    ...state,
    session: {
      ...state.session,
      openTabs: [...state.session.openTabs, createFileTab(tabId, documentId)],
      selectedTabId: tabId,
    },
  };
}

function isDefaultBootstrapWindow(state: AppDomainState): boolean {
  if (state.session.openTabs.length !== 1) {
    return false;
  }
  const tab = state.session.openTabs[0];
  if (!isFileTab(tab)) {
    return false;
  }
  const documentState = state.documents.find((doc) => doc.id === tab.documentId);
  if (!documentState) {
    return false;
  }
  return isEmptyUnsavedDocument(documentState);
}

const initialState: AppDomainState = {
  contexts: {
    activeContextId: NOTEPAD_CONTEXT_ID,
    notepad: {
      documents: [buildEmptyUnsavedDocument("doc-1")],
      session: {
        selectedTabId: "tab-1",
        openTabs: [createFileTab("tab-1", "doc-1")],
        lastActiveWindowId: "main",
        windowBounds: null,
        lastActiveAgentId: null,
      },
    },
    workspaces: [],
  },
  documents: [buildEmptyUnsavedDocument("doc-1")],
  session: {
    selectedTabId: "tab-1",
    openTabs: [createFileTab("tab-1", "doc-1")],
    lastActiveWindowId: "main",
    windowBounds: null,
    lastActiveAgentId: null,
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
      },
    };
  }

  const settingsSlice = createSettingsSlice(update);

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
        const customThemes = syncCustomThemeToken(state.theme.customThemes, id, key, value);
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
      resetIdCounters();
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
      reindexIdCountersFromContexts(contexts);
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
        const { docId: id, tabId } = nextDocAndTabIds();
        const newDocument = buildEmptyUnsavedDocument(id);
        const nextState = {
          ...state,
          documents: [...state.documents, newDocument],
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, createFileTab(tabId, id)],
            selectedTabId: tabId,
          },
        };
        return nextState;
      });
    },
    selectTab(tabId: string) {
      update((state) => selectTabInternal(state, tabId));
    },
    setLastActiveAgentId(agentId: string | null) {
      update((state) => {
        if (state.session.lastActiveAgentId === agentId) {
          return state;
        }
        return {
          ...state,
          session: {
            ...state.session,
            lastActiveAgentId: agentId,
          },
        };
      });
    },
    getLastActiveAgentId(): string | null {
      return this.getSnapshot().session.lastActiveAgentId ?? null;
    },
    openOrFocusAgentTab(agentId: string) {
      update((state) => {
        const existingTab = state.session.openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((tab) => isAgentTab(tab) && tab.agentId === agentId);
        if (existingTab) {
          return selectTabInternal(state, existingTab.id);
        }
        const tabId = nextTabId();
        return {
          ...state,
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, createAgentTab(tabId, agentId)],
            selectedTabId: tabId,
          },
        };
      });
    },
    closeTabsForAgent(agentId: string) {
      update((state) => {
        const tabIds = state.session.openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .filter((tab) => isAgentTab(tab) && tab.agentId === agentId)
          .map((tab) => tab.id);
        return closeTabsForce(state, tabIds, null);
      });
    },
    selectOrReopenTabForDocument(documentId: string) {
      update((state) => {
        const existingTab = state.session.openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((tab) => isFileTab(tab) && tab.documentId === documentId);
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
        const closingTab = openTabs[idx];
        let selectedTabId =
          state.session.selectedTabId === tabId
            ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
            : state.session.selectedTabId;
        if (state.session.selectedTabId === tabId && isAgentTab(closingTab)) {
          const nextAgentTab = findNextOpenAgentTabAfterClose(openTabs, tabId);
          if (nextAgentTab) {
            selectedTabId = nextAgentTab.id;
          }
        }
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
          const { docId, tabId: tabIdNew } = nextDocAndTabIds();
          const newDocument = buildEmptyUnsavedDocument(docId);
          return {
            ...state,
            documents: [...state.documents, newDocument],
            session: {
              ...state.session,
              openTabs: [createFileTab(tabIdNew, docId)],
              selectedTabId: tabIdNew,
              lastActiveAgentId: null,
            },
          };
        }
        const closingTab = openTabs[idx];
        let selectedTabId =
          state.session.selectedTabId === tabId
            ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
            : state.session.selectedTabId;
        if (state.session.selectedTabId === tabId && isAgentTab(closingTab)) {
          const nextAgentTab = findNextOpenAgentTabAfterClose(openTabs, tabId);
          if (nextAgentTab) {
            selectedTabId = nextAgentTab.id;
          }
        }
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
      const targetDocumentId = tabDocumentId(targetTab);
      const targetDocument = targetDocumentId
        ? snapshot.documents.find((documentState) => documentState.id === targetDocumentId)
        : undefined;
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
        const tab = snapshot.session.openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((entry) => entry.id === tabId);
        if (!tab || !isFileTab(tab)) {
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
        const tab = snapshot.session.openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((entry) => entry.id === tabId);
        if (!tab || !isFileTab(tab)) {
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
          const existingTab = state.session.openTabs
            .map((rawTab) => normalizeTabState(rawTab))
            .find((tab) => isFileTab(tab) && tab.documentId === duplicate.id);
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

        const { docId, tabId } = nextDocAndTabIds();
        openedDocumentId = docId;
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
            openTabs: [...state.session.openTabs, createFileTab(tabId, docId)],
            selectedTabId: tabId,
          },
        };
      });
      syncRecentFiles(recentFiles);
      return openedDocumentId;
    },
    buildTabTransferPayload(
      tabId: string,
    ): { filePath: string | null; content: string; title: string } | null {
      const snapshot = this.getSnapshot();
      const tab = snapshot.session.openTabs.find((entry) => entry.id === tabId);
      if (!tab) {
        return null;
      }
      const documentId = tabDocumentId(tab);
      const doc = documentId
        ? snapshot.documents.find((documentState) => documentState.id === documentId)
        : undefined;
      if (!doc) {
        return null;
      }
      return {
        filePath: doc.filePath,
        content: doc.content,
        title: doc.title,
      };
    },
    removeTransferredTab(tabId: string): void {
      this.closeTabForce(tabId);
    },
    transferActiveTabOut(): { filePath: string | null; content: string; title: string } | null {
      const snapshot = this.getSnapshot();
      const selectedTabId = snapshot.session.selectedTabId;
      if (!selectedTabId) {
        return null;
      }
      const payload = this.buildTabTransferPayload(selectedTabId);
      if (!payload) {
        return null;
      }
      this.removeTransferredTab(selectedTabId);
      return payload;
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
              (tab) => isFileTab(tab) && tab.documentId === duplicate.id,
            );
            if (existingTab) {
              return selectTabInternal(state, existingTab.id);
            }
            return reopenTabForDocument(state, duplicate.id);
          }
        }
        const { docId, tabId } = nextDocAndTabIds();
        documentId = docId;
        const newDoc = buildDocument(
          { id: docId, filePath: payload.filePath },
          payload.content,
          payload.title,
        );
        if (isDefaultBootstrapWindow(state)) {
          return {
            ...state,
            documents: [newDoc],
            session: {
              ...state.session,
              openTabs: [createFileTab(tabId, docId)],
              selectedTabId: tabId,
            },
          };
        }
        return {
          ...state,
          documents: [...state.documents, newDoc],
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, createFileTab(tabId, docId)],
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
    setDocumentMarkdownViewMode(
      documentId: string,
      markdownViewMode: DocumentState["markdownViewMode"],
    ) {
      update((state) => {
        let changed = false;
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          if (documentState.markdownViewMode === markdownViewMode) {
            return documentState;
          }
          changed = true;
          return { ...documentState, markdownViewMode };
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
      const normalizedPreviewMode = previewMode === "markdown" ? "editor" : previewMode;
      update((state) => ({
        ...state,
        editor: { ...state.editor, previewMode: normalizedPreviewMode },
      }));
    },
    getActiveWorkspaceLayout(): WorkspaceLayoutState {
      const state = this.getSnapshot();
      if (state.contexts.activeContextId === NOTEPAD_CONTEXT_ID) {
        return defaultWorkspaceLayout();
      }
      return normalizeWorkspaceLayout(state.session.layout);
    },
    updateActiveWorkspaceLayout(partial: Partial<WorkspaceLayoutState>): void {
      update((state) => {
        if (state.contexts.activeContextId === NOTEPAD_CONTEXT_ID) {
          return state;
        }
        const current = normalizeWorkspaceLayout(state.session.layout);
        const nextLayout = normalizeWorkspaceLayout({ ...current, ...partial });
        return {
          ...state,
          session: {
            ...state.session,
            layout: nextLayout,
          },
        };
      });
    },
    setProjectPanelCollapsed(projectPanelCollapsed: boolean) {
      this.updateActiveWorkspaceLayout({ projectPanelCollapsed });
    },
    setAgentsSidebarCollapsed(agentsSidebarCollapsed: boolean) {
      this.updateActiveWorkspaceLayout({ agentsSidebarCollapsed });
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
    ...settingsSlice,
  };
}

export const appState = createStateStore();
