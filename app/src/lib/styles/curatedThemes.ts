import type { ThemeTokenKey, ThemeTokens } from "./themeTokenSchema";
import type { PresetThemeRecord } from "./convertVscodeTheme";

/**
 * Hand-authored theme presets that ship with the app. Unlike
 * {@link file://./importedThemes.ts} (which is regenerated from an external
 * colour-schemes export), these are maintained here directly and cover
 * archetypes the imported set lacks: maximum legibility (high contrast) and
 * retro phosphor terminals (green / amber on black).
 *
 * Every entry is a full {@link ThemeTokens} map so the normalizer has nothing
 * to back-fill. The derived tokens reuse the same `color-mix` formulas as the
 * imported themes so surfaces / borders / scrollbars stay consistent with the
 * rest of the catalog.
 */

interface ThemeCore {
  bgRoot: string;
  surface1: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
}

interface ThemeSyntax {
  keyword: string;
  string: string;
  comment: string;
  number: string;
  type: string;
  heading: string;
  link: string;
  plaintextSymbol: string;
  markup: string;
  punctuation: string;
}

interface ThemeProjectPane {
  hidden: string;
  text: string;
}

/**
 * Builds a full token map from a small set of core colours, deriving the
 * surface / interaction / scrollbar tokens with the same `color-mix` recipes
 * the imported themes use. Callers still supply syntax + project-pane colours
 * explicitly since those carry each theme's identity.
 */
function buildTokens(
  core: ThemeCore,
  syntax: ThemeSyntax,
  projectPane: ThemeProjectPane,
  search: { match: string; current: string },
): ThemeTokens {
  return {
    "color-bg-root": core.bgRoot,
    "color-surface-1": core.surface1,
    "color-surface-overlay":
      "color-mix(in srgb, var(--color-surface-1) 80%, var(--color-text-primary))",
    "color-border-subtle": "color-mix(in srgb, var(--color-text-primary) 18%, transparent)",
    "color-text-primary": core.textPrimary,
    "color-text-secondary": core.textSecondary,
    "color-statusbar-bg": "color-mix(in srgb, var(--color-bg-root) 85%, var(--color-text-primary))",
    "accent-color": core.accent,
    "color-accent": core.accent,
    "color-hover": "color-mix(in srgb, var(--accent-color) 18%, var(--color-bg-root))",
    "color-pressed": "color-mix(in srgb, var(--accent-color) 26%, var(--color-bg-root))",
    "color-focus-ring": "color-mix(in srgb, var(--color-accent) 76%, white)",
    "color-search-match": search.match,
    "color-search-match-current": search.current,
    "scrollbar-track": "color-mix(in srgb, var(--color-bg-root) 92%, var(--color-text-secondary))",
    "scrollbar-thumb": "color-mix(in srgb, var(--color-text-secondary) 72%, transparent)",
    "scrollbar-thumb-hover": "color-mix(in srgb, var(--color-text-secondary) 82%, transparent)",
    "syntax-keyword": syntax.keyword,
    "syntax-string": syntax.string,
    "syntax-comment": syntax.comment,
    "syntax-number": syntax.number,
    "syntax-type": syntax.type,
    "syntax-heading": syntax.heading,
    "syntax-link": syntax.link,
    "syntax-plaintext-symbol": syntax.plaintextSymbol,
    "syntax-markup": syntax.markup,
    "syntax-punctuation": syntax.punctuation,
    "project-pane-color-hidden": projectPane.hidden,
    "project-pane-color-text": projectPane.text,
  } as ThemeTokens;
}

// High-contrast dark: pure black field, pure white type, bright primary syntax
// hues for maximum separation. Legibility-first.
const HIGH_CONTRAST_DARK = buildTokens(
  {
    bgRoot: "#000000",
    surface1: "#000000",
    textPrimary: "#ffffff",
    textSecondary: "#cccccc",
    accent: "#ffff00",
  },
  {
    keyword: "#ffff00",
    string: "#00ff00",
    comment: "#cccccc",
    number: "#ff00ff",
    type: "#00ffff",
    heading: "#ff5555",
    link: "#00ffff",
    plaintextSymbol: "#ffff00",
    markup: "#00ffff",
    punctuation: "#ffffff",
  },
  { hidden: "#cccccc", text: "#ffff00" },
  { match: "rgba(255, 235, 59, 0.45)", current: "rgba(255, 235, 59, 0.75)" },
);

// High-contrast light: pure white field, near-black type, saturated accents.
const HIGH_CONTRAST_LIGHT = buildTokens(
  {
    bgRoot: "#ffffff",
    surface1: "#ffffff",
    textPrimary: "#000000",
    textSecondary: "#333333",
    accent: "#0044cc",
  },
  {
    keyword: "#0000cc",
    string: "#006600",
    comment: "#666666",
    number: "#990099",
    type: "#0066cc",
    heading: "#cc0000",
    link: "#0066cc",
    plaintextSymbol: "#0000cc",
    markup: "#0066cc",
    punctuation: "#000000",
  },
  { hidden: "#666666", text: "#0066cc" },
  { match: "rgba(255, 200, 0, 0.55)", current: "rgba(255, 150, 50, 0.85)" },
);

// Terminal green: phosphor green on black. Syntax stays in the green family
// with brightness variation — the authentic monochrome-terminal look.
const TERMINAL_GREEN = buildTokens(
  {
    bgRoot: "#000000",
    surface1: "#000000",
    textPrimary: "#33ff33",
    textSecondary: "#22aa22",
    accent: "#33ff33",
  },
  {
    keyword: "#33ff33",
    string: "#88ff88",
    comment: "#1f8a1f",
    number: "#33ff33",
    type: "#aaffaa",
    heading: "#33ff33",
    link: "#33ff33",
    plaintextSymbol: "#33ff33",
    markup: "#33ff33",
    punctuation: "#33ff33",
  },
  { hidden: "#22aa22", text: "#33ff33" },
  { match: "rgba(51, 255, 51, 0.30)", current: "rgba(136, 255, 136, 0.55)" },
);

// Terminal amber: amber phosphor on black, brightness-varied syntax.
const TERMINAL_AMBER = buildTokens(
  {
    bgRoot: "#000000",
    surface1: "#000000",
    textPrimary: "#ffb000",
    textSecondary: "#cc8800",
    accent: "#ffb000",
  },
  {
    keyword: "#ffb000",
    string: "#ffcc44",
    comment: "#a86f00",
    number: "#ffb000",
    type: "#ffd180",
    heading: "#ffb000",
    link: "#ffb000",
    plaintextSymbol: "#ffb000",
    markup: "#ffb000",
    punctuation: "#ffb000",
  },
  { hidden: "#cc8800", text: "#ffb000" },
  { match: "rgba(255, 176, 0, 0.30)", current: "rgba(255, 204, 68, 0.55)" },
);

function define(
  id: string,
  name: string,
  baseMode: "dark" | "light",
  tokens: ThemeTokens,
): PresetThemeRecord {
  return { id, name, baseMode, tokens };
}

export const CURATED_THEMES: readonly PresetThemeRecord[] = [
  define("high-contrast-dark", "High Contrast", "dark", HIGH_CONTRAST_DARK),
  define("high-contrast-light", "High Contrast", "light", HIGH_CONTRAST_LIGHT),
  define("terminal-green", "Terminal Green", "dark", TERMINAL_GREEN),
  define("terminal-amber", "Terminal Amber", "dark", TERMINAL_AMBER),
];
