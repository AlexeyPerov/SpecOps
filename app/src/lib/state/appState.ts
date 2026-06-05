import { writable } from "svelte/store";
import type { AppDomainState, AppThemeState, ExternalFilesSettings } from "../domain/contracts";
import { createFileTab } from "../domain/contracts";
import { bumpRecentFile } from "../services/recentFiles";
import { syncRecentFiles } from "../services/recentFilesSync";
import { loadThemeFile } from "../services/themeStore";
import type { BuiltinThemeId } from "../styles/themeTokens";
import { DEFAULT_BUILTIN_THEME } from "../styles/themeTokens";
import {
  findWorkspaceByPath,
  NOTEPAD_CONTEXT_ID,
  resetIdCounters,
} from "./appState/contextHelpers";
import { buildEmptyUnsavedDocument } from "./appState/documentHelpers";
import { createDocumentTabsSlice } from "./appState/documentTabsSlice";
import { resetCommandBindingOverrides } from "../commands/registry";
import { createSettingsSlice, defaultSettings } from "./appState/settingsSlice";
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
import { createWorkspaceContextsSlice } from "./appState/workspaceContextsSlice";

function buildDefaultContextSession() {
  return {
    selectedTabId: "tab-1",
    openTabs: [createFileTab("tab-1", "doc-1")],
    lastActiveWindowId: "main",
    windowBounds: null,
    lastActiveAgentId: null,
  };
}

export { findWorkspaceByPath, resetThemePersistenceForTests, setThemeSaveErrorNotifier };

const initialState: AppDomainState = {
  contexts: {
    activeContextId: NOTEPAD_CONTEXT_ID,
    notepad: {
      documents: [buildEmptyUnsavedDocument("doc-1")],
      session: buildDefaultContextSession(),
    },
    chatHttp: {
      documents: [buildEmptyUnsavedDocument("doc-1")],
      session: buildDefaultContextSession(),
    },
    workspaces: [],
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
    rawUpdate(mutator);
  }

  function getSnapshot(): AppDomainState {
    let snapshot = initialState;
    const un = subscribe((state) => {
      snapshot = state;
    });
    un();
    return snapshot;
  }

  const settingsSlice = createSettingsSlice(update);
  const documentTabsSlice = createDocumentTabsSlice({ update, getSnapshot });
  const workspaceContextsSlice = createWorkspaceContextsSlice({
    update,
    getSnapshot,
    set,
    applyTheme: applyThemeState,
    getInitialEditor: () => initialState.editor,
  });

  return {
    subscribe,
    getSnapshot,
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
      set({ ...getSnapshot(), theme });
      applyThemeState(theme);
    },
    initializeTheme() {
      applyThemeState(getSnapshot().theme);
    },
    resetAppState() {
      resetIdCounters();
      set(initialState);
      applyThemeState(initialState.theme);
      resetCommandBindingOverrides();
    },
    replaceRecentFiles(recentFiles: string[]) {
      update((state) => ({ ...state, recentFiles }));
    },
    touchRecentFile(filePath: string) {
      const recentFiles = bumpRecentFile(getSnapshot().recentFiles, filePath);
      this.replaceRecentFiles(recentFiles);
      void syncRecentFiles(recentFiles);
    },
    clearRecentFiles() {
      this.replaceRecentFiles([]);
      void syncRecentFiles([]);
    },
    removeRecentFile(filePath: string) {
      const recentFiles = getSnapshot().recentFiles.filter((entry) => entry !== filePath);
      this.replaceRecentFiles(recentFiles);
      void syncRecentFiles(recentFiles);
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
    ...workspaceContextsSlice,
    ...documentTabsSlice,
    ...settingsSlice,
  };
}

export const appState = createStateStore();
