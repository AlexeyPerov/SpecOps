import type { AppThemeState } from "../../domain/contracts";
import { IMPORTED_THEMES } from "../../styles/importedThemes";
import {
  defaultThemeFile,
  saveThemeFile,
  type ActiveThemeRef,
  type CustomThemeRecord,
  type ThemeFileV1,
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

function findCustomTheme(theme: AppThemeState, id: string): CustomThemeRecord | undefined {
  return theme.customThemes.find((entry) => entry.id === id);
}

function fallbackBuiltinForTheme(theme: AppThemeState): BuiltinThemeId {
  if (theme.activeTheme.kind === "builtin") {
    return theme.activeTheme.id;
  }
  if (theme.activeTheme.kind === "preset") {
    const preset = IMPORTED_THEMES.find((p) => p.id === theme.activeTheme.id);
    if (!preset) {
      return DEFAULT_BUILTIN_THEME;
    }
    return preset.baseMode === "dark" ? "dark-amber" : "light-blue";
  }
  const custom = findCustomTheme(theme, theme.activeTheme.id);
  if (!custom) {
    return DEFAULT_BUILTIN_THEME;
  }
  return custom.baseMode === "dark" ? "dark-amber" : "light-blue";
}

export function baseModeForTheme(theme: AppThemeState): "dark" | "light" {
  if (theme.activeTheme.kind === "builtin") {
    return getBuiltinThemeMode(theme.activeTheme.id);
  }
  if (theme.activeTheme.kind === "preset") {
    const preset = IMPORTED_THEMES.find((p) => p.id === theme.activeTheme.id);
    return preset?.baseMode ?? "dark";
  }
  return findCustomTheme(theme, theme.activeTheme.id)?.baseMode ?? "dark";
}

export function applyThemeState(theme: AppThemeState): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  if (theme.activeTheme.kind === "builtin") {
    applyBuiltinTheme(theme.activeTheme.id, root);
    return;
  }

  if (theme.activeTheme.kind === "preset") {
    const preset = IMPORTED_THEMES.find((p) => p.id === theme.activeTheme.id);
    if (preset) {
      applyCustomTheme(preset, root);
      return;
    }
    // Unknown preset id (removed in a newer version) — fall back gracefully.
    applyBuiltinTheme(DEFAULT_BUILTIN_THEME, root);
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

export function createCustomThemeFromCurrent(theme: AppThemeState): AppThemeState {
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
