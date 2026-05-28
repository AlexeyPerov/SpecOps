export type BuiltinThemeId = "dark-amber" | "light-blue";

export const BUILTIN_THEME_IDS: BuiltinThemeId[] = ["dark-amber", "light-blue"];

export const DEFAULT_BUILTIN_THEME: BuiltinThemeId = "dark-amber";

export const THEME_TOKEN_KEYS = [
  "color-bg-root",
  "color-surface-1",
  "color-surface-overlay",
  "color-border-subtle",
  "color-text-primary",
  "color-text-secondary",
  "color-statusbar-bg",
  "accent-color",
  "color-accent",
  "color-hover",
  "color-pressed",
  "color-focus-ring",
  "color-search-match",
  "color-search-match-current",
  "scrollbar-track",
  "scrollbar-thumb",
  "scrollbar-thumb-hover",
  "syntax-keyword",
  "syntax-string",
  "syntax-comment",
  "syntax-number",
  "syntax-type",
  "syntax-heading",
  "syntax-link",
  "syntax-markup",
  "syntax-punctuation",
] as const;

export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];

export type ThemeTokens = Record<ThemeTokenKey, string>;

export type ThemeTokenGroupId =
  | "background"
  | "text"
  | "accent"
  | "syntax"
  | "search";

export interface ThemeTokenGroup {
  id: ThemeTokenGroupId;
  label: string;
  keys: ThemeTokenKey[];
}

export const THEME_TOKEN_GROUPS: ThemeTokenGroup[] = [
  {
    id: "background",
    label: "Background & surfaces",
    keys: [
      "color-bg-root",
      "color-surface-1",
      "color-surface-overlay",
      "color-statusbar-bg",
      "scrollbar-track",
      "scrollbar-thumb",
      "scrollbar-thumb-hover",
    ],
  },
  {
    id: "text",
    label: "Text & borders",
    keys: ["color-text-primary", "color-text-secondary", "color-border-subtle"],
  },
  {
    id: "accent",
    label: "Accent & interaction",
    keys: [
      "accent-color",
      "color-accent",
      "color-hover",
      "color-pressed",
      "color-focus-ring",
    ],
  },
  {
    id: "syntax",
    label: "Syntax",
    keys: [
      "syntax-keyword",
      "syntax-string",
      "syntax-comment",
      "syntax-number",
      "syntax-type",
      "syntax-heading",
      "syntax-link",
      "syntax-markup",
      "syntax-punctuation",
    ],
  },
  {
    id: "search",
    label: "Search",
    keys: ["color-search-match", "color-search-match-current"],
  },
];

export const THEME_TOKEN_LABELS: Record<ThemeTokenKey, string> = {
  "color-bg-root": "App background",
  "color-surface-1": "Panels & editor surface",
  "color-surface-overlay": "Overlays",
  "color-border-subtle": "Subtle border",
  "color-text-primary": "Primary text",
  "color-text-secondary": "Secondary text",
  "color-statusbar-bg": "Status bar",
  "accent-color": "Accent",
  "color-accent": "Accent (CSS alias)",
  "color-hover": "Hover",
  "color-pressed": "Pressed",
  "color-focus-ring": "Focus ring",
  "color-search-match": "Search match",
  "color-search-match-current": "Current search match",
  "scrollbar-track": "Scrollbar track",
  "scrollbar-thumb": "Scrollbar thumb",
  "scrollbar-thumb-hover": "Scrollbar thumb (hover)",
  "syntax-keyword": "Keyword",
  "syntax-string": "String",
  "syntax-comment": "Comment",
  "syntax-number": "Number",
  "syntax-type": "Type",
  "syntax-heading": "Heading",
  "syntax-link": "Link",
  "syntax-markup": "Markup",
  "syntax-punctuation": "Punctuation",
};

const BUILTIN_LABELS: Record<BuiltinThemeId, string> = {
  "dark-amber": "Amber (Dark)",
  "light-blue": "Blue (Light)",
};

const BUILTIN_ACCENT_HEX: Record<BuiltinThemeId, string> = {
  "dark-amber": "#d97706",
  "light-blue": "#2376ff",
};

const MODE_UI_TOKEN_KEYS = [
  "color-bg-root",
  "color-surface-1",
  "color-surface-overlay",
  "color-border-subtle",
  "color-text-primary",
  "color-text-secondary",
  "color-statusbar-bg",
  "color-hover",
  "color-pressed",
  "color-focus-ring",
  "color-search-match",
  "color-search-match-current",
  "scrollbar-track",
  "scrollbar-thumb",
  "scrollbar-thumb-hover",
] as const satisfies ReadonlyArray<ThemeTokenKey>;

type ModeUiTokenKey = (typeof MODE_UI_TOKEN_KEYS)[number];

const MODE_UI_TOKENS: Record<"dark" | "light", Record<ModeUiTokenKey, string>> = {
  dark: {
    "color-bg-root": "#0f141b",
    "color-surface-1": "#131a23",
    "color-surface-overlay": "rgb(25 31 40 / var(--opacity-overlay-tint))",
    "color-border-subtle": "rgb(215 227 248 / 18%)",
    "color-text-primary": "#e2e8f0",
    "color-text-secondary": "#9db0c8",
    "color-statusbar-bg": "#101620",
    "color-hover": "rgb(89 152 243 / 18%)",
    "color-pressed": "rgb(89 152 243 / 26%)",
    "color-focus-ring": "color-mix(in srgb, var(--color-accent) 76%, white)",
    "color-search-match": "rgba(255, 200, 0, 0.28)",
    "color-search-match-current": "rgba(255, 150, 50, 0.55)",
    "scrollbar-track": "#0f141b",
    "scrollbar-thumb": "rgb(122 137 159 / 72%)",
    "scrollbar-thumb-hover": "rgb(151 169 196 / 82%)",
  },
  light: {
    "color-bg-root": "#f3f6fa",
    "color-surface-1": "#ffffff",
    "color-surface-overlay": "rgb(255 255 255 / var(--opacity-overlay-tint))",
    "color-border-subtle": "rgb(4 14 26 / 14%)",
    "color-text-primary": "#101828",
    "color-text-secondary": "#475467",
    "color-statusbar-bg": "#ebeff6",
    "color-hover": "rgb(20 71 170 / 10%)",
    "color-pressed": "rgb(20 71 170 / 18%)",
    "color-focus-ring": "color-mix(in srgb, var(--color-accent) 80%, white)",
    "color-search-match": "rgba(255, 200, 0, 0.45)",
    "color-search-match-current": "rgba(255, 150, 50, 0.75)",
    "scrollbar-track": "#e8edf4",
    "scrollbar-thumb": "rgb(71 84 103 / 45%)",
    "scrollbar-thumb-hover": "rgb(71 84 103 / 62%)",
  },
};

export interface ThemeSyntaxPalette {
  keyword: string;
  string: string;
  comment: string;
  number: string;
  type: string;
  heading: string;
  link: string;
  markup: string;
  punctuation: string;
}

const SYNTAX_PALETTE_FIXED: Record<"dark" | "light", Omit<ThemeSyntaxPalette, "keyword" | "type" | "link">> = {
  dark: {
    string: "#98c379",
    comment: "#5c6370",
    number: "#d19a66",
    heading: "#e06c75",
    markup: "#56b6c2",
    punctuation: "#abb2bf",
  },
  light: {
    string: "#50a14f",
    comment: "#a0a1a7",
    number: "#986801",
    heading: "#e45649",
    markup: "#0184bc",
    punctuation: "#383a42",
  },
};

export const SYNTAX_PALETTE_CSS_VARS = [
  "keyword",
  "string",
  "comment",
  "number",
  "type",
  "heading",
  "link",
  "markup",
  "punctuation",
] as const satisfies ReadonlyArray<keyof ThemeSyntaxPalette>;

export interface CustomThemeApplyInput {
  baseMode: "dark" | "light";
  tokens: ThemeTokens;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function mixHex(colorA: string, colorB: string, ratio: number): string {
  const a = parseHex(colorA);
  const b = parseHex(colorB);
  return toHex(
    a.r + (b.r - a.r) * ratio,
    a.g + (b.g - a.g) * ratio,
    a.b + (b.b - a.b) * ratio,
  );
}

function syntaxPaletteToTokens(palette: ThemeSyntaxPalette): Record<`syntax-${keyof ThemeSyntaxPalette}`, string> {
  const tokens = {} as Record<`syntax-${keyof ThemeSyntaxPalette}`, string>;
  for (const key of SYNTAX_PALETTE_CSS_VARS) {
    tokens[`syntax-${key}`] = palette[key];
  }
  return tokens;
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
    };
  }

  return {
    ...fixed,
    keyword: accent,
    type: mixHex(accent, "#ffffff", 0.38),
    link: accent,
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
