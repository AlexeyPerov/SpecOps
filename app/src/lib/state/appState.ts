import { writable } from "svelte/store";
import type { AppDomainState, AppThemeState, ExternalFilesSettings, MarkdownViewMode, ThemeMode } from "../domain/contracts";
import { createFileTab, createSinglePaneLayout } from "../domain/contracts";
import { bumpRecentFile } from "../services/recentFiles";
import { DEFAULT_ACTIVITY_RAIL_WIDTH_PX, normalizeActivityRailWidthPx } from "../services/panelLayout";
import { syncRecentFiles } from "../services/recentFilesSync";
import { loadThemeFile } from "../services/themeStore";
import { BUILTIN_THEME_IDS } from "../styles/themeTokens";
import { IMPORTED_THEMES } from "../styles/importedThemes";
import type { BuiltinThemeId } from "../styles/themeTokens";
import {
  findWorkspaceByPath,
  NOTEPAD_CONTEXT_ID,
  resetIdCounters,
} from "./appState/contextHelpers";
import { buildEmptyUnsavedDocument } from "./appState/documentHelpers";
import { createDocumentTabsSlice } from "./appState/documentTabsSlice";
import { createEditorLayoutSlice } from "./appState/editorLayoutSlice";
import { resetCommandBindingOverrides } from "../commands/commandBindingRuntime";
import { createSettingsSlice, defaultSettings } from "./appState/settingsSlice";
import {
  applyThemeState,
  baseModeForRef,
  createCustomThemeFromCurrent,
  defaultThemeState,
  getSystemPrefersDark,
  persistThemeImmediate,
  resetThemePersistenceForTests,
  resolveActiveTheme,
  scheduleDebouncedThemeSave,
  setThemeSaveErrorNotifier,
  setSystemPrefersDark,
  syncCustomThemeToken,
  type ActiveThemeRef,
  type ThemeTokenKey,
} from "./appState/themeController";
import { createWorkspaceContextsSlice } from "./appState/workspaceContextsSlice";

function buildDefaultContextSession() {
  return {
    editorLayout: createSinglePaneLayout([createFileTab("tab-1", "doc-1", false, true)], "tab-1"),
    lastActiveWindowId: "main",
    windowBounds: null,
    lastActiveSessionId: null,
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
    selectionCount: 1,
    zoomPercent: 100,
    wrapLines: true,
    previewMode: "editor",
  },
  activityRailWidthPx: DEFAULT_ACTIVITY_RAIL_WIDTH_PX,
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
  const editorLayoutSlice = createEditorLayoutSlice({ update });
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
    /**
     * Sets the theme mode (dark/light/auto). `auto` follows the OS
     * `prefers-color-scheme` media query.
     */
    setThemeMode(mode: ThemeMode) {
      update((state) => {
        const theme: AppThemeState = { ...state.theme, mode };
        applyThemeState(theme);
        persistThemeImmediate(theme);
        return { ...state, theme };
      });
    },
    /** Sets the theme applied when the effective mode resolves to dark. */
    setDarkTheme(ref: ActiveThemeRef) {
      update((state) => {
        const theme: AppThemeState = { ...state.theme, darkTheme: ref };
        applyThemeState(theme);
        persistThemeImmediate(theme);
        return { ...state, theme };
      });
    },
    /** Sets the theme applied when the effective mode resolves to light. */
    setLightTheme(ref: ActiveThemeRef) {
      update((state) => {
        const theme: AppThemeState = { ...state.theme, lightTheme: ref };
        applyThemeState(theme);
        persistThemeImmediate(theme);
        return { ...state, theme };
      });
    },
    /** Sets the theme pinned when mode=manual. */
    setManualTheme(ref: ActiveThemeRef) {
      update((state) => {
        const theme: AppThemeState = { ...state.theme, manualTheme: ref };
        applyThemeState(theme);
        persistThemeImmediate(theme);
        return { ...state, theme };
      });
    },
    /**
     * Convenience: assigns `ref` to whichever dark/light slot matches its
     * baseMode. Used by the custom-theme editor and legacy callers that pick
     * "the active theme" without knowing which slot they're targeting.
     */
    setActiveTheme(ref: ActiveThemeRef) {
      update((state) => {
        const baseMode = baseModeForRef(ref, state.theme.customThemes);
        const theme: AppThemeState =
          baseMode === "dark"
            ? { ...state.theme, darkTheme: ref }
            : { ...state.theme, lightTheme: ref };
        applyThemeState(theme);
        persistThemeImmediate(theme);
        return { ...state, theme };
      });
    },
    /** @deprecated Use `setDarkTheme`/`setLightTheme` or `setThemeMode`. */
    setTheme(id: BuiltinThemeId) {
      this.setActiveTheme({ kind: "builtin", id });
    },
    /**
     * Quick-toggle: cycles to the next available theme (builtins → presets →
     * customs, in stable order) and switches to `manual` mode so the ⌘U
     * shortcut immediately renders a different theme.
     */
    cycleTheme() {
      update((state) => {
        const refs: ActiveThemeRef[] = [
          ...BUILTIN_THEME_IDS.map<ActiveThemeRef>((id) => ({ kind: "builtin", id })),
          ...IMPORTED_THEMES.map<ActiveThemeRef>((preset) => ({ kind: "preset", id: preset.id })),
          ...state.theme.customThemes.map<ActiveThemeRef>((custom) => ({
            kind: "custom",
            id: custom.id,
          })),
        ];
        if (refs.length === 0) {
          return state;
        }
        const current = resolveActiveTheme(state.theme);
        const currentIndex = refs.findIndex(
          (ref) => ref.kind === current.kind && ref.id === current.id,
        );
        const nextRef = refs[(currentIndex + 1) % refs.length];
        const theme: AppThemeState = { ...state.theme, mode: "manual", manualTheme: nextRef };
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
        // If the deleted custom was the active ref for either slot, fall that
        // slot back to its builtin default so the rendered theme never dangles.
        const fallbackFor = (ref: ActiveThemeRef): ActiveThemeRef =>
          ref.kind === "custom" && ref.id === id
            ? { kind: "builtin", id: baseModeForRef(ref, customThemes) === "light" ? "light-blue" : "dark-amber" }
            : ref;
        const theme: AppThemeState = {
          ...state.theme,
          darkTheme: fallbackFor(state.theme.darkTheme),
          lightTheme: fallbackFor(state.theme.lightTheme),
          customThemes,
        };
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
        // Re-apply only if the edited custom theme is currently effective.
        const active = resolveActiveTheme(theme);
        if (active.kind === "custom" && active.id === id) {
          applyThemeState(theme);
        }
        scheduleDebouncedThemeSave(theme);
        return { ...state, theme };
      });
    },
    /**
     * Called by the OS color-scheme listener when `prefers-color-scheme` changes.
     * Only re-applies in auto mode (dark/light are pinned regardless of OS).
     */
    applySystemPrefersDark(prefersDark: boolean) {
      setSystemPrefersDark(prefersDark);
      update((state) => {
        if (state.theme.mode !== "auto") {
          return state;
        }
        applyThemeState(state.theme, prefersDark);
        return state;
      });
    },
    async loadTheme(): Promise<void> {
      const file = await loadThemeFile();
      const theme: AppThemeState = {
        mode: file.mode,
        darkTheme: file.darkTheme,
        lightTheme: file.lightTheme,
        manualTheme: file.manualTheme,
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
    setCursor(line: number, column: number, selectionCount: number = 1) {
      update((state) => ({
        ...state,
        editor: {
          ...state.editor,
          cursorLine: line,
          cursorColumn: column,
          selectionCount,
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
    setShowMinimap(value: boolean) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          showMinimap: value,
        },
      }));
    },
    setDefaultMarkdownViewMode(value: MarkdownViewMode) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          defaultMarkdownViewMode: value,
        },
      }));
    },
    /**
     * Persists the activity-rail width. Window-scoped and independent of the
     * active mode/workspace — survives context switches and window reloads.
     */
    setActivityRailWidth(widthPx: number) {
      const normalized = normalizeActivityRailWidthPx(widthPx);
      update((state) =>
        state.activityRailWidthPx === normalized
          ? state
          : { ...state, activityRailWidthPx: normalized },
      );
    },
    ...workspaceContextsSlice,
    ...documentTabsSlice,
    ...editorLayoutSlice,
    ...settingsSlice,
  };
}

export const appState = createStateStore();
