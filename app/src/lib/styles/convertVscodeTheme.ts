/**
 * Converts a VS Code / TextMate color-theme JSON shape into our flat
 * {@link ThemeTokens} map. The daylerees colour-schemes archive (and any
 * standard VS Code theme JSON) provides only the editor surface: a handful of
 * `colors` keys plus TextMate `tokenColors` scope rules. Everything else in our
 * 28-token schema is derived with `color-mix` so the result is coherent.
 *
 * Kept dependency-free and side-effect-free so the converter can be driven both
 * by a one-off generation script (see `app/scripts/import-daylerees-themes.mjs`)
 * and by unit tests.
 */
import type { BuiltinThemeId } from "./themeTokenSchema";
import {
  BUILTIN_THEME_IDS,
  DEFAULT_BUILTIN_THEME,
  THEME_TOKEN_KEYS,
  type ThemeTokenKey,
  type ThemeTokens,
} from "./themeTokenSchema";
import { resolveBuiltinTokens } from "./themeTokens";

/** Minimal VS Code theme JSON shape we consume. */
export interface VscodeTokenRule {
  name?: string;
  scope?: string | string[];
  settings?: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
    [legacy: string]: string | undefined;
  };
}

export interface VscodeThemeColors {
  "editor.background"?: string;
  "editor.foreground"?: string;
  "editorCursor.foreground"?: string;
  "editorWhitespace.foreground"?: string;
  "editor.lineHighlightBackground"?: string;
  "editor.selectionBackground"?: string;
  [key: string]: string | undefined;
}

export interface VscodeThemeJson {
  name?: string;
  type?: "light" | "dark" | "hc";
  colors?: VscodeThemeColors;
  tokenColors?: VscodeTokenRule[];
}

/**
 * uiTheme from the sibling `package.json` manifest. `vs` → light, `vs-dark` and
 * `hc-black` → dark.
 */
export type VscodeUiTheme = "vs" | "vs-dark" | "hc-black";

export interface ConvertOptions {
  /** Theme id used for the generated {@link PresetThemeRecord.id}. */
  id: string;
  /** Display name; falls back to the JSON `name` then `id`. */
  name?: string;
  /** Mode resolved from the JSON `type` field or the manifest `uiTheme`. */
  baseMode: "dark" | "light";
}

export interface PresetThemeRecord {
  id: string;
  name: string;
  baseMode: "dark" | "light";
  tokens: ThemeTokens;
}

/** Picks the most saturated hex among a list; used to guess an accent color. */
function mostSaturatedHex(hexes: string[]): string | null {
  const parsed = hexes
    .map((hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
      if (!m) {
        return null;
      }
      const n = m[1];
      const r = Number.parseInt(n.slice(0, 2), 16);
      const g = Number.parseInt(n.slice(2, 4), 16);
      const b = Number.parseInt(n.slice(4, 6), 16);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      return { hex: `#${n.toLowerCase()}`, saturation, max };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (parsed.length === 0) {
    return null;
  }
  parsed.sort((a, b) => b.saturation - a.saturation || b.max - a.max);
  return parsed[0].hex;
}

/** Lowercased fallback accent per mode when no syntax color is available. */
const FALLBACK_ACCENT: Record<"dark" | "light", string> = {
  dark: "#57a1ff",
  light: "#2376ff",
};

/**
 * Syntax token ids that represent a theme's identity (its primary hues). Only
 * these feed accent selection — markup/punctuation/link are often shared diff
 * colors that would otherwise dominate (e.g. the daylerees `#00a8c6` template
 * color present in every theme).
 */
const ACCENT_SOURCES: ReadonlySet<ThemeTokenKey> = new Set([
  "syntax-keyword",
  "syntax-string",
  "syntax-number",
  "syntax-type",
  "syntax-heading",
]);

const SCOPE_TO_SYNTAX: ReadonlyArray<{ scopes: RegExp; token: ThemeTokenKey }> = [
  { scopes: /^comment$/, token: "syntax-comment" },
  { scopes: /^string$/, token: "syntax-string" },
  { scopes: /^constant\.numeric$/, token: "syntax-number" },
  { scopes: /^(keyword|storage)$/, token: "syntax-keyword" },
  {
    scopes: /^(entity\.name\.(class|type|struct|interface)|support\.type|storage\.type)$/,
    token: "syntax-type",
  },
  {
    scopes: /^(entity\.name\.section|markup\.heading)$/,
    token: "syntax-heading",
  },
  { scopes: /^(markup\.underline\.link|entity\.name\.tag)$/, token: "syntax-link" },
  // Narrow markup to inline emphasis scopes; the daylerees template sets
  // markup.deleted/inserted/raw to a shared `#00a8c6` which would otherwise
  // pollute markup and accent selection.
  { scopes: /^markup\.(bold|italic|quote|list|list-)/, token: "syntax-markup" },
  { scopes: /^punctuation\b/, token: "syntax-punctuation" },
];

/** Collects the first matching foreground per scope rule (string or array). */
function collectSyntaxColors(tokenColors: VscodeTokenRule[]): Partial<ThemeTokens> {
  const syntax: Partial<ThemeTokens> = {};
  for (const rule of tokenColors) {
    const foreground = rule.settings?.foreground;
    if (!foreground || !rule.scope) {
      continue;
    }
    const scopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
    for (const scope of scopes) {
      for (const mapping of SCOPE_TO_SYNTAX) {
        if (mapping.scopes.test(scope) && syntax[mapping.token] === undefined) {
          syntax[mapping.token] = foreground;
        }
      }
    }
  }
  return syntax;
}

/** Lightens `hex` toward white by `ratio` (0–1). Returns a hex string. */
function lighten(hex: string, ratio: number): string {
  return mixHexHex(hex, "#ffffff", ratio);
}

function mixHexHex(a: string, b: string, ratio: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const clamp = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(pa.r + (pb.r - pa.r) * ratio)}${clamp(pa.g + (pb.g - pa.g) * ratio)}${clamp(
    pa.b + (pb.b - pa.b) * ratio,
  )}`;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

/** Inlines a `color-mix` expression referencing named token CSS vars. */
function mix(tokenA: ThemeTokenKey, pctA: number, tokenB: ThemeTokenKey): string {
  return `color-mix(in srgb, var(--${tokenA}) ${Math.round(pctA * 100)}%, var(--${tokenB}))`;
}

/** Builds the base token map (before normalization) from a vscode theme. */
function buildTokens(json: VscodeThemeJson, baseMode: "dark" | "light"): Partial<ThemeTokens> {
  const globalSettings = json.tokenColors?.find((rule) => !rule.scope)?.settings ?? {};
  const colors = json.colors ?? {};

  const bgRoot =
    colors["editor.background"] ?? globalSettings.background ?? (baseMode === "dark" ? "#0f141b" : "#f3f6fa");
  const foreground =
    colors["editor.foreground"] ??
    globalSettings.foreground ??
    (baseMode === "dark" ? "#e2e8f0" : "#101828");
  const selectionBg = colors["editor.selectionBackground"];
  const findHighlight = globalSettings.findHighlight;

  const surface1 = lighten(bgRoot, baseMode === "dark" ? 0.06 : 0.04);
  const syntax = collectSyntaxColors(json.tokenColors ?? []);
  const accent =
    mostSaturatedHex(
      Object.entries(syntax)
        .filter(([key]) => ACCENT_SOURCES.has(key as ThemeTokenKey))
        .map(([, value]) => value)
        .filter((v): v is string => Boolean(v)),
    ) ?? FALLBACK_ACCENT[baseMode];

  const tokens: Partial<ThemeTokens> = {
    "color-bg-root": bgRoot,
    "color-surface-1": surface1,
    "color-text-primary": foreground,
    "color-statusbar-bg": mix("color-bg-root", 0.85, "color-text-primary"),
    "color-border-subtle": `color-mix(in srgb, var(--color-text-primary) ${baseMode === "dark" ? 18 : 14}%, transparent)`,
    "color-text-secondary":
      syntax["syntax-comment"] ?? mix("color-text-primary", 0.6, "color-bg-root"),
    "color-surface-overlay": mix("color-surface-1", 0.8, "color-text-primary"),
    "accent-color": accent,
    "color-accent": accent,
    "color-hover": mix("accent-color", baseMode === "dark" ? 0.18 : 0.1, "color-bg-root"),
    "color-pressed": mix("accent-color", baseMode === "dark" ? 0.26 : 0.18, "color-bg-root"),
    "color-focus-ring": "color-mix(in srgb, var(--color-accent) 76%, white)",
    "color-search-match": selectionBg ?? "rgba(255, 200, 0, 0.4)",
    "color-search-match-current": findHighlight ?? "rgba(255, 150, 50, 0.7)",
    "scrollbar-track": mix("color-bg-root", 0.92, "color-text-secondary"),
    "scrollbar-thumb": `color-mix(in srgb, var(--color-text-secondary) ${baseMode === "dark" ? 72 : 45}%, transparent)`,
    "scrollbar-thumb-hover": `color-mix(in srgb, var(--color-text-secondary) ${baseMode === "dark" ? 82 : 62}%, transparent)`,
    "project-pane-color-hidden": syntax["syntax-comment"] ?? mix("color-text-primary", 0.6, "color-bg-root"),
    "project-pane-color-text": accent,
    "syntax-plaintext-symbol": syntax["syntax-keyword"] ?? accent,
    ...syntax,
  };

  return tokens;
}

/** Resolves a base mode from the JSON `type` field or the manifest uiTheme. */
export function resolveBaseMode(
  type: ConvertOptions["baseMode"] | undefined,
  uiTheme: VscodeUiTheme | undefined,
): "dark" | "light" {
  if (type === "light" || type === "dark") {
    return type;
  }
  if (uiTheme === "vs") {
    return "light";
  }
  return "dark";
}

/**
 * Converts a parsed vscode theme JSON into our token schema. Missing tokens are
 * back-filled from the builtin defaults for `baseMode` via {@link normalizeThemeTokens},
 * so partial input always produces a complete {@link ThemeTokens}.
 */
export function convertVscodeTheme(
  json: VscodeThemeJson,
  options: ConvertOptions,
): PresetThemeRecord {
  const tokens = normalizeThemeTokens(buildTokens(json, options.baseMode), options.baseMode);
  const name = (options.name ?? json.name ?? options.id).trim() || options.id;
  return { id: options.id, name, baseMode: options.baseMode, tokens };
}

/**
 * Fills every {@link THEME_TOKEN_KEYS} entry from the builtin defaults for the
 * mode, then overlays the partial converted tokens. Exported so the converter
 * and any future import flow share the same completion rule.
 */
export function normalizeThemeTokens(
  partial: Partial<ThemeTokens>,
  baseMode: "dark" | "light",
): ThemeTokens {
  const builtinId: BuiltinThemeId = baseMode === "dark" ? "dark-amber" : "light-blue";
  const defaults = resolveBuiltinTokens(builtinId);
  const result = {} as ThemeTokens;
  for (const key of THEME_TOKEN_KEYS) {
    result[key] = partial[key]?.trim() || defaults[key];
  }
  return result;
}

/** Pure sanity helper used by tests / the script. */
export function isPresetThemeRecord(value: unknown): value is PresetThemeRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    (record.baseMode === "dark" || record.baseMode === "light") &&
    typeof record.tokens === "object" &&
    record.tokens !== null
  );
}

export { BUILTIN_THEME_IDS, DEFAULT_BUILTIN_THEME };
