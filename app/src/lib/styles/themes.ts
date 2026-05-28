import type { BuiltinThemeId } from "./themeTokens";
import {
  applyThemeSyntaxPalette,
  BUILTIN_THEME_IDS,
  DEFAULT_BUILTIN_THEME,
  getBuiltinAccentHex,
  getBuiltinThemeLabel,
  getBuiltinThemeMode,
  getThemeSyntaxPalette,
  isBuiltinThemeId,
  normalizeLegacyThemeId,
  SYNTAX_PALETTE_CSS_VARS,
  type ThemeSyntaxPalette,
} from "./themeTokens";

export type { BuiltinThemeId, ThemeSyntaxPalette } from "./themeTokens";
export {
  applyThemeSyntaxPalette,
  BUILTIN_THEME_IDS,
  DEFAULT_BUILTIN_THEME,
  getBuiltinAccentHex,
  getBuiltinThemeLabel,
  getBuiltinThemeMode,
  getThemeSyntaxPalette,
  isBuiltinThemeId,
  normalizeLegacyThemeId,
  SYNTAX_PALETTE_CSS_VARS,
};

/** @deprecated Use `BuiltinThemeId` from `themeTokens.ts`. */
export type AppTheme = BuiltinThemeId;

/** @deprecated Use `BUILTIN_THEME_IDS`. */
export const APP_THEME_IDS = BUILTIN_THEME_IDS;

/** @deprecated Use `DEFAULT_BUILTIN_THEME`. */
export const DEFAULT_THEME = DEFAULT_BUILTIN_THEME;

/** @deprecated Use `getBuiltinThemeLabel`. */
export const getThemeLabel = getBuiltinThemeLabel;

/** @deprecated Use `getBuiltinThemeMode`. */
export const getThemeMode = getBuiltinThemeMode;

/** @deprecated Use `getBuiltinAccentHex`. */
export const getThemeAccentHex = getBuiltinAccentHex;

/** @deprecated Use `isBuiltinThemeId`. */
export function isValidTheme(value: string): value is AppTheme {
  return isBuiltinThemeId(value);
}
