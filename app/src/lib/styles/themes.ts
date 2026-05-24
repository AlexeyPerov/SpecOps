export type AppTheme =
  | "dark-blue"
  | "dark-violet"
  | "dark-green"
  | "dark-amber"
  | "dark-rose"
  | "dark-teal"
  | "light-blue"
  | "light-violet"
  | "light-green"
  | "light-amber"
  | "light-rose"
  | "light-teal";

export const APP_THEME_IDS: AppTheme[] = [
  "dark-blue",
  "dark-violet",
  "dark-green",
  "dark-amber",
  "dark-rose",
  "dark-teal",
  "light-blue",
  "light-violet",
  "light-green",
  "light-amber",
  "light-rose",
  "light-teal",
];

export const DEFAULT_THEME: AppTheme = "dark-blue";

const ACCENT_LABELS: Record<string, string> = {
  blue: "Blue",
  violet: "Violet",
  green: "Green",
  amber: "Amber",
  rose: "Rose",
  teal: "Teal",
};

export function getThemeLabel(id: AppTheme): string {
  const [mode, accent] = id.split("-");
  const modeLabel = mode === "dark" ? "Dark" : "Light";
  return `${ACCENT_LABELS[accent] ?? accent} (${modeLabel})`;
}

export function getThemeMode(id: AppTheme): "dark" | "light" {
  return id.startsWith("dark") ? "dark" : "light";
}

export function getThemeAccentHex(id: AppTheme): string {
  const isDark = getThemeMode(id) === "dark";
  const map: Record<string, [string, string]> = {
    blue: ["#2f80ed", "#2376ff"],
    violet: ["#8b5cf6", "#7c3aed"],
    green: ["#22a06b", "#16a34a"],
    amber: ["#d97706", "#b45309"],
    rose: ["#e11d48", "#be123c"],
    teal: ["#0891b2", "#0e7490"],
  };
  const [, accent] = id.split("-");
  const pair = map[accent] ?? map.blue;
  return isDark ? pair[0] : pair[1];
}

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

export function getThemeSyntaxPalette(id: AppTheme): ThemeSyntaxPalette {
  const mode = getThemeMode(id);
  const accent = getThemeAccentHex(id);
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

export function applyThemeSyntaxPalette(id: AppTheme, root: HTMLElement): void {
  const palette = getThemeSyntaxPalette(id);
  for (const key of SYNTAX_PALETTE_CSS_VARS) {
    root.style.setProperty(`--syntax-${key}`, palette[key]);
  }
}

export function isValidTheme(value: string): value is AppTheme {
  return (APP_THEME_IDS as readonly string[]).includes(value);
}
