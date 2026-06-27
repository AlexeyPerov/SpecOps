import type { AppThemeState } from "../../domain/contracts";
import { IMPORTED_THEMES } from "../../styles/importedThemes";
import {
  defaultThemeFile,
  saveThemeFile,
  type ActiveThemeRef,
  type CustomThemeRecord,
  type ThemeFileV2,
} from "../../services/themeStore";
import type { BuiltinThemeId } from "../../styles/themeTokens";
import {
  applyBuiltinTheme,
  applyCustomTheme,
  DEFAULT_BUILTIN_THEME,
  getBuiltinThemeMode,
  resolveBuiltinTokens,
  snapshotThemeTokens,
  type ThemeTokenKey,
  type ThemeTokens,
} from "../../styles/themeTokens";

export const defaultThemeState: AppThemeState = {
  mode: defaultThemeFile.mode,
  darkTheme: defaultThemeFile.darkTheme,
  lightTheme: defaultThemeFile.lightTheme,
  manualTheme: defaultThemeFile.manualTheme,
  customThemes: defaultThemeFile.customThemes,
};

/**
 * Current OS color-scheme preference, mirrored from the
 * `(prefers-color-scheme: dark)` media query via {@link subscribeSystemColorScheme}.
 * Callers that don't have a fresh value handy (e.g. re-applying a preserved theme
 * after a window-session swap) read this default via {@link applyThemeState}.
 */
let systemPrefersDark = readSystemPrefersDark();

function readSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getSystemPrefersDark(): boolean {
  return systemPrefersDark;
}

export function setSystemPrefersDark(value: boolean): void {
  systemPrefersDark = value;
}

/**
 * Subscribes to the OS `prefers-color-scheme` media query. Returns an unlisten
 * function. No-op (returns a no-op) when `matchMedia` is unavailable (jsdom,
 * SSR). On each OS change `onChange` is invoked with the new preference; the
 * caller re-resolves the active theme when `mode === "auto"`.
 */
export function subscribeSystemColorScheme(onChange: (prefersDark: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (event: MediaQueryListEvent) => {
    systemPrefersDark = event.matches;
    onChange(event.matches);
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

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
  systemPrefersDark = readSystemPrefersDark();
}

export function setThemeSaveErrorNotifier(notifier: (message: string) => void): void {
  themeSaveErrorNotifier = notifier;
}

function toThemeFile(theme: AppThemeState): ThemeFileV2 {
  return {
    version: 2,
    mode: theme.mode,
    darkTheme: theme.darkTheme,
    lightTheme: theme.lightTheme,
    manualTheme: theme.manualTheme,
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

export function persistThemeImmediate(theme: AppThemeState): void {
  if (themeSaveTimer) {
    clearTimeout(themeSaveTimer);
    themeSaveTimer = null;
  }
  void persistThemeNow(theme);
}

export function scheduleDebouncedThemeSave(theme: AppThemeState): void {
  if (themeSaveTimer) {
    clearTimeout(themeSaveTimer);
  }
  themeSaveTimer = setTimeout(() => {
    themeSaveTimer = null;
    void persistThemeNow(theme);
  }, THEME_TOKEN_SAVE_DEBOUNCE_MS);
}

function findCustomTheme(customThemes: CustomThemeRecord[], id: string): CustomThemeRecord | undefined {
  return customThemes.find((entry) => entry.id === id);
}

/** Resolves the dark/light classification of a single theme ref. */
export function baseModeForRef(
  ref: ActiveThemeRef,
  customThemes: CustomThemeRecord[],
): "dark" | "light" {
  if (ref.kind === "builtin") {
    return getBuiltinThemeMode(ref.id);
  }
  if (ref.kind === "preset") {
    return IMPORTED_THEMES.find((p) => p.id === ref.id)?.baseMode ?? "dark";
  }
  return findCustomTheme(customThemes, ref.id)?.baseMode ?? "dark";
}

/**
 * Resolves which theme ref is currently effective given the mode and OS color
 * scheme. `manual` pins {@link AppThemeState.manualTheme}; `auto` follows
 * {@link systemPrefersDark} and switches between dark/light slots.
 */
export function resolveActiveTheme(
  theme: AppThemeState,
  prefersDark: boolean = systemPrefersDark,
): ActiveThemeRef {
  if (theme.mode === "manual") {
    return theme.manualTheme;
  }
  return prefersDark ? theme.darkTheme : theme.lightTheme;
}

function fallbackBuiltinForRef(
  ref: ActiveThemeRef,
  customThemes: CustomThemeRecord[],
): BuiltinThemeId {
  if (ref.kind === "builtin") {
    return ref.id;
  }
  const baseMode = baseModeForRef(ref, customThemes);
  return baseMode === "dark" ? "dark-amber" : "light-blue";
}

export function applyThemeState(theme: AppThemeState, prefersDark?: boolean): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const ref = resolveActiveTheme(theme, prefersDark);

  if (ref.kind === "builtin") {
    applyBuiltinTheme(ref.id, root);
    return;
  }

  if (ref.kind === "preset") {
    const preset = IMPORTED_THEMES.find((p) => p.id === ref.id);
    if (preset) {
      applyCustomTheme(preset, root);
      return;
    }
    // Unknown preset id (removed in a newer version) — fall back gracefully.
    applyBuiltinTheme(DEFAULT_BUILTIN_THEME, root);
    return;
  }

  const custom = findCustomTheme(theme.customThemes, ref.id);
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
  const ref = resolveActiveTheme(theme);
  const fallbackBuiltin = fallbackBuiltinForRef(ref, theme.customThemes);
  if (typeof document !== "undefined") {
    try {
      return snapshotThemeTokens(document.documentElement, fallbackBuiltin);
    } catch {
      // jsdom or pre-paint environment
    }
  }
  return resolveBuiltinTokens(fallbackBuiltin);
}

/**
 * Snapshots the currently effective theme's tokens into a new editable custom
 * theme, inherits its baseMode, makes it the active ref for that mode, and
 * applies it to the DOM. Returns the next theme state.
 */
export function createCustomThemeFromCurrent(theme: AppThemeState): AppThemeState {
  const ref = resolveActiveTheme(theme);
  const baseMode = baseModeForRef(ref, theme.customThemes);
  const tokens = snapshotCurrentThemeTokens(theme);
  const id = crypto.randomUUID();
  const custom: CustomThemeRecord = {
    id,
    name: nextCustomThemeName(theme.customThemes),
    baseMode,
    tokens,
  };

  const customRef: ActiveThemeRef = { kind: "custom", id };
  const nextTheme: AppThemeState = {
    ...theme,
    customThemes: [...theme.customThemes, custom],
    darkTheme: baseMode === "dark" ? customRef : theme.darkTheme,
    lightTheme: baseMode === "light" ? customRef : theme.lightTheme,
  };
  applyThemeState(nextTheme);
  return nextTheme;
}

export function syncCustomThemeToken(
  customThemes: CustomThemeRecord[],
  id: string,
  key: ThemeTokenKey,
  value: string,
): CustomThemeRecord[] {
  const trimmed = value.trim();
  return customThemes.map((custom) => {
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
}

export type { ActiveThemeRef, ThemeTokenKey };
