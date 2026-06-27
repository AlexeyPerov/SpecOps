// Generates `app/src/lib/styles/importedThemes.ts` from the daylerees
// colour-schemes vscode export. Run from the repo root:
//
//   node app/scripts/import-daylerees-themes.mjs <path-to-colour-schemes-master/vscode>
//
// where <path> is the folder containing `daylerees.theme.<name>/<name>.json`
// subdirectories plus their sibling `package.json`. The script reads each
// theme's JSON plus its manifest `uiTheme`, converts it with the same logic the
// app uses, and writes a single committed module exporting `IMPORTED_THEMES`.
//
// Curated subset (per product decision): the first 10 themes alphabetically
// descending, plus `github` (light) and `darkside` (dark). Edit `THEMES` to
// change the shipped set.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = resolve(process.argv[2] ?? "");
const OUT_PATH = resolve(__dirname, "../src/lib/styles/importedThemes.ts");

if (!SOURCE_ROOT) {
  console.error("Usage: node app/scripts/import-daylerees-themes.mjs <vscode-source-root>");
  process.exit(1);
}

const THEMES = [
  "zacks",
  "yule",
  "turnip",
  "tron",
  "tribal",
  "tonic",
  "super",
  "stark",
  "sourlick",
  "solarflare",
  "github",
  "darkside",
];

// --- Pure color helpers (mirror convertVscodeTheme.ts, kept dependency-free) ---

function parseHex(hex) {
  const n = hex.replace("#", "");
  return {
    r: Number.parseInt(n.slice(0, 2), 16),
    g: Number.parseInt(n.slice(2, 4), 16),
    b: Number.parseInt(n.slice(4, 6), 16),
  };
}

function toHex(r, g, b) {
  const clamp = (v) =>
    Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function mixHex(a, b, ratio) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  return toHex(pa.r + (pb.r - pa.r) * ratio, pa.g + (pb.g - pa.g) * ratio, pa.b + (pb.b - pa.b) * ratio);
}

function lighten(hex, ratio) {
  return mixHex(hex, "#ffffff", ratio);
}

function mostSaturatedHex(hexes) {
  const parsed = hexes
    .map((hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
      if (!m) return null;
      const n = m[1];
      const r = Number.parseInt(n.slice(0, 2), 16);
      const g = Number.parseInt(n.slice(2, 4), 16);
      const b = Number.parseInt(n.slice(4, 6), 16);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      return { hex: `#${n.toLowerCase()}`, saturation, max };
    })
    .filter(Boolean);
  if (parsed.length === 0) return null;
  parsed.sort((a, b) => b.saturation - a.saturation || b.max - a.max);
  return parsed[0].hex;
}

const FALLBACK_ACCENT = { dark: "#57a1ff", light: "#2376ff" };

const SCOPE_TO_SYNTAX = [
  { scopes: /^comment$/, token: "syntax-comment" },
  { scopes: /^string$/, token: "syntax-string" },
  { scopes: /^constant\.numeric$/, token: "syntax-number" },
  { scopes: /^(keyword|storage)$/, token: "syntax-keyword" },
  { scopes: /^(entity\.name\.(class|type|struct|interface)|support\.type|storage\.type)$/, token: "syntax-type" },
  { scopes: /^(entity\.name\.section|markup\.heading)$/, token: "syntax-heading" },
  { scopes: /^(markup\.underline\.link|entity\.name\.tag)$/, token: "syntax-link" },
  // Narrow markup to inline emphasis scopes; the daylerees template sets
  // markup.deleted/inserted/raw to a shared `#00a8c6` which would otherwise
  // pollute markup and accent selection.
  { scopes: /^markup\.(bold|italic|quote|list|list-)/, token: "syntax-markup" },
  { scopes: /^punctuation\b/, token: "syntax-punctuation" },
];

const ACCENT_SOURCES = new Set([
  "syntax-keyword", "syntax-string", "syntax-number", "syntax-type", "syntax-heading",
]);

function collectSyntax(tokenColors) {
  const syntax = {};
  for (const rule of tokenColors) {
    const fg = rule.settings?.foreground;
    if (!fg || !rule.scope) continue;
    const scopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
    for (const scope of scopes) {
      for (const { scopes: re, token } of SCOPE_TO_SYNTAX) {
        if (re.test(scope) && syntax[token] === undefined) syntax[token] = fg;
      }
    }
  }
  return syntax;
}

function mix(tokenA, pctA, tokenB) {
  return `color-mix(in srgb, var(--${tokenA}) ${Math.round(pctA * 100)}%, var(--${tokenB}))`;
}

// Builtin defaults mirror resolveBuiltinTokens; only the values we fall back to.
const BUILTIN_DEFAULTS = {
  dark: {
    "color-bg-root": "#0f141b", "color-surface-1": "#131a23", "color-surface-overlay": "rgb(25 31 40 / var(--opacity-overlay-tint))",
    "color-border-subtle": "rgb(215 227 248 / 18%)", "color-text-primary": "#e2e8f0", "color-text-secondary": "#9db0c8",
    "accent-color": "#57a1ff", "color-accent": "#57a1ff", "color-hover": "rgb(89 152 243 / 18%)", "color-pressed": "rgb(89 152 243 / 26%)",
    "color-focus-ring": "color-mix(in srgb, var(--color-accent) 76%, white)", "color-statusbar-bg": "#101620",
    "color-search-match": "rgba(255, 200, 0, 0.28)", "color-search-match-current": "rgba(255, 150, 50, 0.55)",
    "scrollbar-track": "#0f141b", "scrollbar-thumb": "rgb(122 137 159 / 72%)", "scrollbar-thumb-hover": "rgb(151 169 196 / 82%)",
    "syntax-keyword": "#57a1ff", "syntax-string": "#98c379", "syntax-comment": "#5c6370", "syntax-number": "#d19a66",
    "syntax-type": "#e5c07b", "syntax-heading": "#e06c75", "syntax-link": "#61afef", "syntax-plaintext-symbol": "#57a1ff",
    "syntax-markup": "#56b6c2", "syntax-punctuation": "#abb2bf", "project-pane-color-hidden": "#9db0c8", "project-pane-color-text": "#56b6c2",
  },
  light: {
    "color-bg-root": "#f3f6fa", "color-surface-1": "#ffffff", "color-surface-overlay": "rgb(255 255 255 / var(--opacity-overlay-tint))",
    "color-border-subtle": "rgb(4 14 26 / 14%)", "color-text-primary": "#101828", "color-text-secondary": "#475467",
    "accent-color": "#2376ff", "color-accent": "#2376ff", "color-hover": "rgb(20 71 170 / 10%)", "color-pressed": "rgb(20 71 170 / 18%)",
    "color-focus-ring": "color-mix(in srgb, var(--color-accent) 80%, white)", "color-statusbar-bg": "#ebeff6",
    "color-search-match": "rgba(255, 200, 0, 0.45)", "color-search-match-current": "rgba(255, 150, 50, 0.75)",
    "scrollbar-track": "#e8edf4", "scrollbar-thumb": "rgb(71 84 103 / 45%)", "scrollbar-thumb-hover": "rgb(71 84 103 / 62%)",
    "syntax-keyword": "#2376ff", "syntax-string": "#50a14f", "syntax-comment": "#a0a1a7", "syntax-number": "#986801",
    "syntax-type": "#c18401", "syntax-heading": "#e45649", "syntax-link": "#4078f2", "syntax-plaintext-symbol": "#2376ff",
    "syntax-markup": "#0184bc", "syntax-punctuation": "#383a42", "project-pane-color-hidden": "#475467", "project-pane-color-text": "#0891b2",
  },
};

const TOKEN_KEYS = [
  "color-bg-root", "color-surface-1", "color-surface-overlay", "color-border-subtle",
  "color-text-primary", "color-text-secondary", "color-statusbar-bg",
  "accent-color", "color-accent", "color-hover", "color-pressed", "color-focus-ring",
  "color-search-match", "color-search-match-current",
  "scrollbar-track", "scrollbar-thumb", "scrollbar-thumb-hover",
  "syntax-keyword", "syntax-string", "syntax-comment", "syntax-number", "syntax-type",
  "syntax-heading", "syntax-link", "syntax-plaintext-symbol", "syntax-markup", "syntax-punctuation",
  "project-pane-color-hidden", "project-pane-color-text",
];

function convertTheme(json, id, baseMode) {
  const globalSettings = (json.tokenColors ?? []).find((r) => !r.scope)?.settings ?? {};
  const colors = json.colors ?? {};
  const bgRoot = colors["editor.background"] ?? globalSettings.background ?? BUILTIN_DEFAULTS[baseMode]["color-bg-root"];
  const foreground = colors["editor.foreground"] ?? globalSettings.foreground ?? BUILTIN_DEFAULTS[baseMode]["color-text-primary"];
  const selectionBg = colors["editor.selectionBackground"];
  const findHighlight = globalSettings.findHighlight;
  const surface1 = lighten(bgRoot, baseMode === "dark" ? 0.06 : 0.04);
  const syntax = collectSyntax(json.tokenColors ?? []);
  const accentHexes = Object.entries(syntax)
    .filter(([key]) => ACCENT_SOURCES.has(key))
    .map(([, v]) => v)
    .filter(Boolean);
  const accent = mostSaturatedHex(accentHexes) ?? FALLBACK_ACCENT[baseMode];

  const partial = {
    "color-bg-root": bgRoot,
    "color-surface-1": surface1,
    "color-text-primary": foreground,
    "color-statusbar-bg": mix("color-bg-root", 0.85, "color-text-primary"),
    "color-border-subtle": `color-mix(in srgb, var(--color-text-primary) ${baseMode === "dark" ? 18 : 14}%, transparent)`,
    "color-text-secondary": syntax["syntax-comment"] ?? mix("color-text-primary", 0.6, "color-bg-root"),
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

  const defaults = BUILTIN_DEFAULTS[baseMode];
  const tokens = {};
  for (const key of TOKEN_KEYS) {
    const v = partial[key]?.trim();
    tokens[key] = v || defaults[key];
  }
  const name = (json.name ?? id).trim() || id;
  return { id, name, baseMode, tokens };
}

function readTheme(themeName) {
  const themeDir = join(SOURCE_ROOT, `daylerees.theme.${themeName}`);
  const themeJson = JSON.parse(readFileSync(join(themeDir, `${themeName}.json`), "utf8"));
  const manifest = JSON.parse(readFileSync(join(themeDir, "package.json"), "utf8"));
  const uiTheme = manifest.contributes?.themes?.[0]?.uiTheme;
  const baseMode = uiTheme === "vs" ? "light" : "dark";
  return convertTheme(themeJson, themeName, baseMode);
}

// --- Main ---

const presets = THEMES.map(readTheme);

const header = `// AUTO-GENERATED by \`app/scripts/import-daylerees-themes.mjs\` from the
// daylerees colour-schemes vscode export. Do not edit by hand — re-run the
// script to regenerate. Curated subset of ${presets.length} themes.
import type { PresetThemeRecord } from "./convertVscodeTheme";

export const IMPORTED_THEMES: readonly PresetThemeRecord[] = `;

const body = JSON.stringify(presets, null, 2);
const footer = ";\n";

writeFileSync(OUT_PATH, `${header}${body}${footer}`, "utf8");
console.log(`Wrote ${presets.length} presets to ${OUT_PATH}`);
for (const preset of presets) {
  console.log(`  - ${preset.name} (${preset.baseMode}) → ${preset.tokens["accent-color"]}`);
}
