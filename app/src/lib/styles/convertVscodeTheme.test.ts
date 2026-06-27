import { describe, expect, it } from "vitest";
import {
  convertVscodeTheme,
  isPresetThemeRecord,
  normalizeThemeTokens,
  resolveBaseMode,
  type VscodeThemeJson,
  type VscodeUiTheme,
} from "./convertVscodeTheme";
import { THEME_TOKEN_KEYS } from "./themeTokenSchema";

const SAMPLE: VscodeThemeJson = {
  name: "sample",
  colors: {
    "editor.background": "#222324",
    "editor.foreground": "#bababa",
    "editor.selectionBackground": "#516b6b4d",
  },
  tokenColors: [
    {
      settings: {
        background: "#222324",
        foreground: "#bababa",
        findHighlight: "#ffe792",
      },
    },
    { name: "Comment", scope: "comment", settings: { foreground: "#494b4d" } },
    { name: "String", scope: "string", settings: { foreground: "#f2d42c" } },
    { name: "Number", scope: "constant.numeric", settings: { foreground: "#8e69c9" } },
    { name: "Keyword", scope: "keyword", settings: { foreground: "#f08d24" } },
    { name: "Storage type", scope: "storage.type", settings: { foreground: "#e8341c" } },
    { name: "Heading", scope: "entity.name.section", settings: { foreground: "#ff00aa" } },
    { name: "Link", scope: "markup.underline.link", settings: { foreground: "#61afef" } },
    { name: "Multi", scope: ["constant.character", "constant.other"], settings: { foreground: "#00ff00" } },
    { name: "Markup", scope: "markup.bold", settings: { foreground: "#abcdef" } },
    { name: "MarkupDeleted", scope: "markup.deleted", settings: { foreground: "#00a8c6" } },
    { name: "Punctuation", scope: "punctuation.definition", settings: { foreground: "#689" } },
  ],
};

describe("convertVscodeTheme", () => {
  it("maps direct colors and fills all 28 tokens", () => {
    const preset = convertVscodeTheme(SAMPLE, { id: "sample", baseMode: "dark" });
    expect(preset.id).toBe("sample");
    expect(preset.name).toBe("sample");
    expect(preset.baseMode).toBe("dark");
    for (const key of THEME_TOKEN_KEYS) {
      expect(preset.tokens[key]).toBeTruthy();
    }
    expect(preset.tokens["color-bg-root"]).toBe("#222324");
    expect(preset.tokens["color-text-primary"]).toBe("#bababa");
  });

  it("maps syntax scopes (string and array, first match wins)", () => {
    const preset = convertVscodeTheme(SAMPLE, { id: "sample", baseMode: "dark" });
    expect(preset.tokens["syntax-comment"]).toBe("#494b4d");
    expect(preset.tokens["syntax-string"]).toBe("#f2d42c");
    expect(preset.tokens["syntax-number"]).toBe("#8e69c9");
    expect(preset.tokens["syntax-keyword"]).toBe("#f08d24");
    expect(preset.tokens["syntax-type"]).toBe("#e8341c");
    expect(preset.tokens["syntax-heading"]).toBe("#ff00aa");
    expect(preset.tokens["syntax-link"]).toBe("#61afef");
    expect(preset.tokens["syntax-markup"]).toBe("#abcdef");
    expect(preset.tokens["syntax-punctuation"]).toBe("#689");
    // plaintext-symbol mirrors keyword (matches builtin pattern)
    expect(preset.tokens["syntax-plaintext-symbol"]).toBe("#f08d24");
  });

  it("derives accent only from identity syntax colors, excluding markup diff colors", () => {
    const preset = convertVscodeTheme(SAMPLE, { id: "sample", baseMode: "dark" });
    // Accent sources are keyword/string/number/type/heading only.
    expect(["#f08d24", "#f2d42c", "#8e69c9", "#e8341c", "#ff00aa"]).toContain(
      preset.tokens["accent-color"],
    );
    expect(preset.tokens["color-accent"]).toBe(preset.tokens["accent-color"]);
    // The shared `#00a8c6` from markup.deleted must never leak into markup or accent.
    expect(preset.tokens["syntax-markup"]).toBe("#abcdef");
    expect(preset.tokens["accent-color"]).not.toBe("#00a8c6");
  });

  it("falls back to builtin defaults when a vscode theme omits data", () => {
    const minimal: VscodeThemeJson = { name: "bare" };
    const preset = convertVscodeTheme(minimal, { id: "bare", baseMode: "light" });
    expect(preset.baseMode).toBe("light");
    // Every token present, sourced from the light builtin defaults.
    for (const key of THEME_TOKEN_KEYS) {
      expect(preset.tokens[key]).toBeTruthy();
    }
  });

  it("uses options.name and options.id when JSON lacks them", () => {
    const preset = convertVscodeTheme(
      { tokenColors: [] },
      { id: "custom-id", name: "Custom Name", baseMode: "dark" },
    );
    expect(preset.id).toBe("custom-id");
    expect(preset.name).toBe("Custom Name");
  });
});

describe("resolveBaseMode", () => {
  it("prefers explicit type over uiTheme", () => {
    expect(resolveBaseMode("light", "vs-dark")).toBe("light");
    expect(resolveBaseMode("dark", "vs")).toBe("dark");
  });

  it("maps uiTheme vs → light, vs-dark/hc-black → dark", () => {
    const cases: Array<[VscodeUiTheme, "dark" | "light"]> = [
      ["vs", "light"],
      ["vs-dark", "dark"],
      ["hc-black", "dark"],
    ];
    for (const [uiTheme, expected] of cases) {
      expect(resolveBaseMode(undefined, uiTheme)).toBe(expected);
    }
  });

  it("defaults to dark when nothing is provided", () => {
    expect(resolveBaseMode(undefined, undefined)).toBe("dark");
  });
});

describe("normalizeThemeTokens", () => {
  it("overlays partial on builtin defaults for the mode", () => {
    const tokens = normalizeThemeTokens({ "color-bg-root": "#abcdef" }, "dark");
    expect(tokens["color-bg-root"]).toBe("#abcdef");
    // untouched token came from the dark builtin defaults, not undefined
    expect(tokens["color-text-primary"]).toBeTruthy();
  });

  it("ignores empty/whitespace values", () => {
    const tokens = normalizeThemeTokens({ "color-bg-root": "   " }, "light");
    expect(tokens["color-bg-root"]).not.toBe("   ");
    expect(tokens["color-bg-root"]).toBeTruthy();
  });
});

describe("isPresetThemeRecord", () => {
  it("accepts a well-formed record", () => {
    const preset = convertVscodeTheme(SAMPLE, { id: "s", baseMode: "dark" });
    expect(isPresetThemeRecord(preset)).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isPresetThemeRecord(null)).toBe(false);
    expect(isPresetThemeRecord({})).toBe(false);
    expect(isPresetThemeRecord({ id: "x", baseMode: "dark" })).toBe(false);
    expect(
      isPresetThemeRecord({ id: "x", name: "x", baseMode: "weird", tokens: {} }),
    ).toBe(false);
  });
});
