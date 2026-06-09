import {
  BUILTIN_ACCENT_HEX,
  BUILTIN_LABELS,
  MODE_UI_TOKENS,
  PROJECT_PANE_TOKENS,
  SYNTAX_PALETTE_FIXED,
} from "./themeTokenDefaults";
import {
  mixHex,
  SYNTAX_PALETTE_CSS_VARS,
  syntaxPaletteToTokens,
  type ThemeSyntaxPalette,
} from "./themeSyntaxTokens";
import {
  BUILTIN_THEME_IDS,
  DEFAULT_BUILTIN_THEME,
  THEME_TOKEN_KEYS,
  THEME_TOKEN_GROUPS,
  THEME_TOKEN_LABELS,
  type BuiltinThemeId,
  type ThemeTokenKey,
  type ThemeTokens,
} from "./themeTokenSchema";

export {
  BUILTIN_THEME_IDS,
  DEFAULT_BUILTIN_THEME,
  THEME_TOKEN_KEYS,
  THEME_TOKEN_GROUPS,
  THEME_TOKEN_LABELS,
};
export type { BuiltinThemeId, ThemeTokenKey, ThemeTokens };
export { SYNTAX_PALETTE_CSS_VARS };
export type { ThemeSyntaxPalette };

export interface CustomThemeApplyInput {
  baseMode: "dark" | "light";
  tokens: ThemeTokens;
}

export function getBuiltinThemeLabel(id: BuiltinThemeId): string {
  return BUILTIN_LABELS[id];
}

export function getBuiltinThemeMode(id: BuiltinThemeId): "dark" | "light" {
  return id.startsWith("dark") ? "dark" : "light";
}

export function getBuiltinAccentHex(id: BuiltinThemeId): string {
  return BUILTIN_ACCENT_HEX[id];
}

export function isBuiltinThemeId(value: string): value is BuiltinThemeId {
  return (BUILTIN_THEME_IDS as readonly string[]).includes(value);
}

/** Maps legacy 12-accent theme ids and `themeMode`/`accent` pairs to a built-in theme. */
export function normalizeLegacyThemeId(value: string): BuiltinThemeId | null {
  if (isBuiltinThemeId(value)) {
    return value;
  }
  if (value.startsWith("dark-")) {
    return "dark-amber";
  }
  if (value.startsWith("light-")) {
    return "light-blue";
  }
  return null;
}

export function getThemeSyntaxPalette(id: BuiltinThemeId): ThemeSyntaxPalette {
  const mode = getBuiltinThemeMode(id);
  const accent = getBuiltinAccentHex(id);
  const fixed = SYNTAX_PALETTE_FIXED[mode];

  if (mode === "dark") {
    return {
      ...fixed,
      keyword: accent,
      type: mixHex(accent, "#ffffff", 0.28),
      link: mixHex(accent, "#ffffff", 0.14),
      "plaintext-symbol": accent,
    };
  }

  return {
    ...fixed,
    keyword: accent,
    type: mixHex(accent, "#ffffff", 0.38),
    link: accent,
    "plaintext-symbol": accent,
  };
}

export function resolveBuiltinTokens(id: BuiltinThemeId): ThemeTokens {
  const mode = getBuiltinThemeMode(id);
  const accent = getBuiltinAccentHex(id);
  const ui = MODE_UI_TOKENS[mode];
  const syntax = syntaxPaletteToTokens(getThemeSyntaxPalette(id));

  return {
    ...ui,
    "accent-color": accent,
    "color-accent": accent,
    ...syntax,
    ...PROJECT_PANE_TOKENS[mode],
  };
}

function cssVarName(key: ThemeTokenKey): string {
  return `--${key}`;
}

export function clearThemeOverrides(root: HTMLElement): void {
  for (const key of THEME_TOKEN_KEYS) {
    root.style.removeProperty(cssVarName(key));
  }
}

export function applyBuiltinTheme(id: BuiltinThemeId, root: HTMLElement): void {
  const mode = getBuiltinThemeMode(id);
  root.dataset.theme = mode;
  clearThemeOverrides(root);

  const accent = getBuiltinAccentHex(id);
  root.style.setProperty("--accent-color", accent);
  root.style.setProperty("--color-accent", accent);

  const palette = getThemeSyntaxPalette(id);
  for (const key of SYNTAX_PALETTE_CSS_VARS) {
    root.style.setProperty(`--syntax-${key}`, palette[key]);
  }
}

export function applyThemeSyntaxPalette(id: BuiltinThemeId, root: HTMLElement): void {
  const palette = getThemeSyntaxPalette(id);
  for (const key of SYNTAX_PALETTE_CSS_VARS) {
    root.style.setProperty(`--syntax-${key}`, palette[key]);
  }
}

export function applyCustomTheme(custom: CustomThemeApplyInput, root: HTMLElement): void {
  root.dataset.theme = custom.baseMode;

  for (const key of THEME_TOKEN_KEYS) {
    const value = custom.tokens[key];
    root.style.setProperty(cssVarName(key), value);
  }

  const accent = custom.tokens["accent-color"];
  root.style.setProperty("--color-accent", accent);
}

export function snapshotThemeTokens(
  root: HTMLElement,
  fallbackBuiltinId?: BuiltinThemeId,
): ThemeTokens {
  const fallback = fallbackBuiltinId
    ? resolveBuiltinTokens(fallbackBuiltinId)
    : resolveBuiltinTokens(DEFAULT_BUILTIN_THEME);
  const snapshot = {} as ThemeTokens;

  for (const key of THEME_TOKEN_KEYS) {
    const inline = root.style.getPropertyValue(cssVarName(key)).trim();
    const computed =
      typeof getComputedStyle === "function"
        ? getComputedStyle(root).getPropertyValue(cssVarName(key)).trim()
        : "";
    snapshot[key] = inline || computed || fallback[key];
  }

  return snapshot;
}
