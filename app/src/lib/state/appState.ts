import { writable } from "svelte/store";
import type {
  AccentOption,
  AppDomainState,
  AppSettingsState,
  ThemeMode,
} from "../domain/contracts";

const defaultSettings: AppSettingsState = {
  themeMode: "dark",
  accent: "blue",
  statusBarVisible: true,
};

const initialState: AppDomainState = {
  documents: [
    {
      id: "doc-1",
      filePath: null,
      title: "Untitled",
      content: "# Spec Ops\n\nCodeMirror baseline is ready.",
      isDirty: false,
      language: "markdown",
      encoding: "utf-8",
      lineEnding: "lf",
    },
  ],
  session: {
    selectedTabId: "tab-1",
    openTabs: [{ id: "tab-1", documentId: "doc-1", pinned: false }],
    lastActiveWindowId: "main",
  },
  settings: defaultSettings,
};

const accentColors: Record<AccentOption, string> = {
  blue: "#2f80ed",
  violet: "#8b5cf6",
  green: "#22a06b",
};

function applyTheme(settings: AppSettingsState): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = settings.themeMode;
  document.documentElement.style.setProperty(
    "--accent-color",
    accentColors[settings.accent],
  );
}

function createStateStore() {
  const { subscribe, update } = writable<AppDomainState>(initialState);

  return {
    subscribe,
    toggleTheme() {
      update((state) => {
        const themeMode: ThemeMode =
          state.settings.themeMode === "dark" ? "light" : "dark";
        const settings = { ...state.settings, themeMode };
        applyTheme(settings);
        return { ...state, settings };
      });
    },
    cycleAccent() {
      update((state) => {
        const accents: AccentOption[] = ["blue", "violet", "green"];
        const index = accents.indexOf(state.settings.accent);
        const accent = accents[(index + 1) % accents.length];
        const settings = { ...state.settings, accent };
        applyTheme(settings);
        return { ...state, settings };
      });
    },
    initializeTheme() {
      applyTheme(initialState.settings);
    },
  };
}

export const appState = createStateStore();
