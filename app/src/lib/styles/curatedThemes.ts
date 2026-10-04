import type { ThemeTokens } from "./themeTokenSchema";
import type { PresetThemeRecord } from "./convertVscodeTheme";

/**
 * Hand-authored theme presets that ship with the app. Unlike
 * {@link file://./importedThemes.ts} (which is regenerated from an external
 * colour-schemes export), these are maintained here directly and cover
 * archetypes the imported set lacks: maximum legibility (high contrast) and
 * retro phosphor terminals (green / amber on black).
 *
 * Presets provide the palette and optional appearance recommendations.
 * Semantic state colors inherit mode defaults where not specified. Derived
 * surfaces, borders and scrollbars use the shared color-mix recipes.
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
    textSecondary: "#65b965",
    accent: "#33ff33",
  },
  {
    keyword: "#33ff33",
    string: "#88ff88",
    comment: "#65b965",
    number: "#33ff33",
    type: "#aaffaa",
    heading: "#33ff33",
    link: "#33ff33",
    plaintextSymbol: "#33ff33",
    markup: "#33ff33",
    punctuation: "#33ff33",
  },
  { hidden: "#65b965", text: "#33ff33" },
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
    comment: "#cc9a44",
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
  appearance: Partial<import("./themeAppearance").ThemeAppearance> = {},
  category: PresetThemeRecord["category"] = "accessible",
): PresetThemeRecord {
  return { id, name, baseMode, tokens, appearance, category };
}

const terminalStyle: Partial<import("./themeAppearance").ThemeAppearance> = {
  uiFont: "plex", chatFont: "plex", codeFont: "plex", corners: "square", elevation: "flat",
  icons: "monochrome", caret: "block", borders: "strong", density: "compact", glow: 18, scanlines: 15, vignette: 20,
};
/** Compact palette input; all interaction and semantic colors remain theme-aware. */
function palette(
  id: string, name: string, baseMode: "dark" | "light",
  colors: readonly string[], appearance: PresetThemeRecord["appearance"] = {},
  category: PresetThemeRecord["category"] = "classic",
): PresetThemeRecord {
  const [bg, panel, fg, muted, accent, keyword, string, number, type, danger, success, warning] = colors;
  const tokens = buildTokens(
    { bgRoot: bg, surface1: panel, textPrimary: fg, textSecondary: muted, accent },
    { keyword, string, comment: muted, number, type, heading: accent, link: type,
      plaintextSymbol: keyword, markup: type, punctuation: fg },
    { hidden: muted, text: fg },
    { match: `color-mix(in srgb, ${warning} 25%, transparent)`, current: `color-mix(in srgb, ${warning} 45%, transparent)` },
  );
  Object.assign(tokens, { "color-danger": danger, "color-success": success, "color-warning": warning,
    "color-diff-added": success, "color-diff-removed": danger });
  return { id, name, baseMode, tokens, appearance, category };
}

export const CURATED_THEMES: readonly PresetThemeRecord[] = [
  define("high-contrast-dark", "High Contrast", "dark", HIGH_CONTRAST_DARK),
  define("high-contrast-light", "High Contrast", "light", HIGH_CONTRAST_LIGHT),
  define("terminal-green", "Terminal Green", "dark", TERMINAL_GREEN, terminalStyle, "retro"),
  define("terminal-amber", "Terminal Amber", "dark", TERMINAL_AMBER, terminalStyle, "retro"),
  palette("catppuccin-mocha", "Catppuccin Mocha", "dark", ["#1e1e2e", "#181825", "#cdd6f4", "#a6adc8", "#cba6f7", "#cba6f7", "#a6e3a1", "#fab387", "#89b4fa", "#f38ba8", "#a6e3a1", "#f9e2af"]),
  palette("catppuccin-macchiato", "Catppuccin Macchiato", "dark", ["#24273a", "#1e2030", "#cad3f5", "#a5adcb", "#c6a0f6", "#c6a0f6", "#a6da95", "#f5a97f", "#8aadf4", "#ed8796", "#a6da95", "#eed49f"]),
  palette("catppuccin-frappe", "Catppuccin Frappé", "dark", ["#303446", "#292c3c", "#c6d0f5", "#a5adce", "#ca9ee6", "#ca9ee6", "#a6d189", "#ef9f76", "#8caaee", "#e78284", "#a6d189", "#e5c890"]),
  palette("catppuccin-latte", "Catppuccin Latte", "light", ["#eff1f5", "#e6e9ef", "#4c4f69", "#6c6f85", "#8839ef", "#8839ef", "#40a02b", "#fe640b", "#1e66f5", "#d20f39", "#278018", "#956900"]),
  palette("dracula", "Dracula", "dark", ["#282a36", "#21222c", "#f8f8f2", "#a3acc9", "#bd93f9", "#ff79c6", "#f1fa8c", "#bd93f9", "#8be9fd", "#ff5555", "#50fa7b", "#ffb86c"]),
  palette("nord", "Nord", "dark", ["#2e3440", "#3b4252", "#eceff4", "#a5b1c2", "#88c0d0", "#81a1c1", "#a3be8c", "#b48ead", "#8fbcbb", "#bf616a", "#a3be8c", "#ebcb8b"]),
  palette("solarized-dark", "Solarized", "dark", ["#002b36", "#073642", "#93a1a1", "#839496", "#268bd2", "#859900", "#2aa198", "#d33682", "#268bd2", "#dc322f", "#859900", "#b58900"]),
  palette("solarized-light", "Solarized", "light", ["#fdf6e3", "#eee8d5", "#586e75", "#657b83", "#268bd2", "#668000", "#187f76", "#b82c72", "#267bb5", "#c62828", "#527300", "#8c6900"]),
  palette("gruvbox-dark", "Gruvbox", "dark", ["#282828", "#32302f", "#ebdbb2", "#bdae93", "#fabd2f", "#fb4934", "#b8bb26", "#d3869b", "#83a598", "#fb4934", "#b8bb26", "#fabd2f"]),
  palette("gruvbox-light", "Gruvbox", "light", ["#fbf1c7", "#f2e5bc", "#3c3836", "#665c54", "#9d6000", "#9d0006", "#667000", "#8f3f71", "#076678", "#9d0006", "#667000", "#9d6000"]),
  palette("tokyo-night", "Tokyo Night", "dark", ["#1a1b26", "#16161e", "#c0caf5", "#939fc8", "#7aa2f7", "#bb9af7", "#9ece6a", "#ff9e64", "#7dcfff", "#f7768e", "#9ece6a", "#e0af68"]),
  palette("tokyo-storm", "Tokyo Storm", "dark", ["#24283b", "#1f2335", "#c0caf5", "#a0acd3", "#7aa2f7", "#bb9af7", "#9ece6a", "#ff9e64", "#7dcfff", "#f7768e", "#9ece6a", "#e0af68"]),
  palette("tokyo-moon", "Tokyo Moon", "dark", ["#222436", "#1e2030", "#c8d3f5", "#a2afcf", "#82aaff", "#c099ff", "#c3e88d", "#ff966c", "#86e1fc", "#ff757f", "#c3e88d", "#ffc777"]),
  palette("tokyo-day", "Tokyo Day", "light", ["#e1e2e7", "#d6d8df", "#3760bf", "#536a94", "#2e7de9", "#7847bd", "#416916", "#99551b", "#007197", "#b52b50", "#416916", "#805b10"]),
  palette("one-dark", "One Dark", "dark", ["#282c34", "#21252b", "#abb2bf", "#979fad", "#61afef", "#c678dd", "#98c379", "#d19a66", "#e5c07b", "#e06c75", "#98c379", "#e5c07b"]),
  palette("one-light", "One Light", "light", ["#fafafa", "#f0f0f0", "#383a42", "#696c77", "#4078f2", "#a626a4", "#307b30", "#986801", "#986801", "#c53e36", "#307b30", "#986801"]),
  palette("monokai", "Monokai", "dark", ["#272822", "#20211b", "#f8f8f2", "#aaa998", "#a6e22e", "#f92672", "#e6db74", "#ae81ff", "#66d9ef", "#ff5c8a", "#a6e22e", "#fd971f"]),
  palette("neutral-dark", "Neutral Dark", "dark", ["#181818", "#222222", "#e6e6e6", "#aaaaaa", "#78a9ff", "#d4a0ef", "#9acb86", "#d8b878", "#86c9dc", "#ff8a80", "#9acb86", "#e4bf73"]),
  palette("dos-blue", "DOS Blue", "dark", ["#000080", "#000066", "#ffffff", "#b5c5ff", "#55ffff", "#ffffff", "#ffff55", "#55ffff", "#55ffff", "#ffaaaa", "#aaffaa", "#ffff55"], { ...terminalStyle, uiFont: "terminal", chatFont: "terminal", codeFont: "terminal", glow: 0, scanlines: 8, vignette: 0 }, "retro"),
  palette("vintage-lcd", "Vintage LCD", "light", ["#c4cea3", "#b6c293", "#253622", "#46563a", "#294d28", "#253622", "#294d28", "#364e26", "#253622", "#7b3027", "#294d28", "#654b15"], { ...terminalStyle, glow: 0, scanlines: 12, vignette: 8 }, "retro"),
  palette("paper-ink", "Paper & Ink", "light", ["#f7f0e3", "#eee5d5", "#302b25", "#706458", "#8b4932", "#765237", "#486341", "#8b4932", "#3e6077", "#a5322b", "#486341", "#856000"], { chatFont: "serif", codeFont: "plex", chatLineHeight: 1.75, elevation: "flat", corners: "square", texture: 25, density: "spacious" }, "creative"),
  palette("synthwave", "Synthwave", "dark", ["#21152f", "#2c1c40", "#f0e5ff", "#bfa5d5", "#ff73d1", "#ff73d1", "#71f6d1", "#ffcb75", "#86dcff", "#ff829d", "#71f6d1", "#ffcb75"], { glow: 12, corners: "round", elevation: "raised" }, "creative"),
  palette("blueprint", "Blueprint", "dark", ["#102b4d", "#15385f", "#e0efff", "#9dbbd7", "#8bd7ff", "#ffffff", "#b5e4ee", "#f2d58b", "#8bd7ff", "#ffb0a0", "#b4e8c6", "#f2d58b"], { uiFont: "plex", chatFont: "plex", corners: "square", borders: "strong", elevation: "flat", texture: 12 }, "creative"),
  palette("crt-green", "CRT Green", "dark", ["#020802", "#041204", "#79f779", "#71b771", "#79f779", "#a9ffa9", "#65e765", "#9fff9f", "#b9ffb9", "#ff9f80", "#79f779", "#f1dc89"], { ...terminalStyle, uiFont: "terminal", chatFont: "terminal", codeFont: "terminal", glow: 32, scanlines: 30, vignette: 35 }, "retro"),
  palette("crt-amber", "CRT Amber", "dark", ["#090600", "#151004", "#ffc45c", "#cba65e", "#ffc45c", "#ffda88", "#efb953", "#ffe4a6", "#ffda88", "#ff9080", "#c5e08a", "#ffe4a6"], { ...terminalStyle, uiFont: "terminal", chatFont: "terminal", codeFont: "terminal", glow: 32, scanlines: 30, vignette: 35 }, "retro"),
];
