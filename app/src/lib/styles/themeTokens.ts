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
  /**
   * Tokens to apply. State/diff tokens may be absent — presets inherit them
   * from the per-mode defaults in tokens.css. Custom themes are always
   * complete (ThemeTokens); presets are Partial.
   */
  tokens: Partial<ThemeTokens>;
}

/**
 * Tokens that may hold a CSS gradient (background surfaces) instead of a solid
 * color. All other tokens feed `color-mix` derivatives or render as tiny
 * swatches, so they must stay solid.
 */
export const GRADIENT_CAPABLE_KEYS: ReadonlySet<ThemeTokenKey> = new Set<ThemeTokenKey>([
  "color-bg-root",
  "color-surface-1",
  "color-surface-overlay",
  "color-statusbar-bg",
  "scrollbar-track",
]);

/**
 * Returns the solid CSS color embedded in `value`. Non-gradient values pass
 * through unchanged; for gradients the first color stop is extracted so
 * `color-mix` derivatives (which cannot accept a gradient) keep working.
 * Returns `#000000` if no parseable hex/rgb/hsl color is found.
 */
export function extractSolidColor(value: string): string {
  const trimmed = value.trim();
  if (!/gradient/i.test(trimmed)) {
    return trimmed;
  }
  // Match the first concrete color stop — hex, rgba()/rgb(), hsla()/hsl().
  // The bare-keyword branch is deliberately omitted so gradient function names
  // (`linear`/`radial`/`conic`) and `transparent` don't shadow real stops.
  const match = trimmed.match(/#(?:[0-9a-f]{3,8})|rgba?\([^)]+\)|hsla?\([^)]+\)/i);
  return match ? match[0] : "#000000";
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

/** Removes every `<key>-solid` var written by gradient-capable token apply. */
export function clearGradientSolidVars(root: HTMLElement): void {
  for (const key of GRADIENT_CAPABLE_KEYS) {
    root.style.removeProperty(`${cssVarName(key)}-solid`);
  }
}

export function applyBuiltinTheme(id: BuiltinThemeId, root: HTMLElement): void {
  const mode = getBuiltinThemeMode(id);
  root.dataset.theme = mode;
  clearThemeOverrides(root);
  clearGradientSolidVars(root);

  const accent = getBuiltinAccentHex(id);
  root.style.setProperty("--accent-color", accent);
  root.style.setProperty("--color-accent", accent);

  const palette = getThemeSyntaxPalette(id);
  for (const key of SYNTAX_PALETTE_CSS_VARS) {
    root.style.setProperty(`--syntax-${key}`, palette[key]);
  }

  // Builtin tokens are solid, so `-solid` mirrors them exactly. This keeps the
  // `color-mix` surface derivatives in `tokens.css` reading the same value
  // regardless of whether a builtin or custom/gradient theme is active.
  const tokens = resolveBuiltinTokens(id);
  for (const key of GRADIENT_CAPABLE_KEYS) {
    root.style.setProperty(`${cssVarName(key)}-solid`, tokens[key]);
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
  clearGradientSolidVars(root);

  for (const key of THEME_TOKEN_KEYS) {
    const value = custom.tokens[key];
    // Skip keys the theme object doesn't provide (e.g. preset themes generated
    // before a token was added to the schema) so the per-mode default in
    // tokens.css is inherited instead of being overwritten with an empty string.
    if (!value) {
      root.style.removeProperty(cssVarName(key));
      continue;
    }
    root.style.setProperty(cssVarName(key), value);
    if (GRADIENT_CAPABLE_KEYS.has(key)) {
      root.style.setProperty(`${cssVarName(key)}-solid`, extractSolidColor(value));
    }
  }

  const accent = custom.tokens["accent-color"];
  if (accent) {
    root.style.setProperty("--color-accent", accent);
  }
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
    // `getComputedStyle` throws on non-Element inputs (e.g. test mocks), so
    // guard it rather than let a stray mock break the snapshot path.
    let computed = "";
    if (typeof getComputedStyle === "function") {
      try {
        computed = getComputedStyle(root).getPropertyValue(cssVarName(key)).trim();
      } catch {
        computed = "";
      }
    }
    snapshot[key] = inline || computed || fallback[key];
  }

  return snapshot;
}
