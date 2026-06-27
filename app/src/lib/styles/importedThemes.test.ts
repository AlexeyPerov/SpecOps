import { describe, expect, it } from "vitest";
import { IMPORTED_THEMES } from "./importedThemes";
import { THEME_TOKEN_KEYS } from "./themeTokenSchema";

const EXPECTED_IDS = [
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

describe("IMPORTED_THEMES", () => {
  it("contains the curated set of 12 presets", () => {
    const ids = IMPORTED_THEMES.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(EXPECTED_IDS));
    expect(IMPORTED_THEMES).toHaveLength(EXPECTED_IDS.length);
  });

  it("has unique ids", () => {
    const ids = IMPORTED_THEMES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every preset has all 29 tokens, a valid baseMode, and a non-empty name", () => {
    for (const preset of IMPORTED_THEMES) {
      expect(preset.name.trim().length).toBeGreaterThan(0);
      expect(preset.baseMode === "dark" || preset.baseMode === "light").toBe(true);
      for (const key of THEME_TOKEN_KEYS) {
        expect(preset.tokens[key], `${preset.id} missing ${key}`).toBeTruthy();
      }
    }
  });

  it("github is light and darkside is dark (sanity checks against source manifests)", () => {
    const github = IMPORTED_THEMES.find((p) => p.id === "github");
    const darkside = IMPORTED_THEMES.find((p) => p.id === "darkside");
    expect(github?.baseMode).toBe("light");
    expect(darkside?.baseMode).toBe("dark");
  });

  it("accents are distinct and not the shared daylerees template cyan #00a8c6", () => {
    const accents = IMPORTED_THEMES.map((p) => p.tokens["accent-color"].toLowerCase());
    // The shared template color must never leak through as a theme accent.
    for (const accent of accents) {
      expect(accent).not.toBe("#00a8c6");
    }
    // And there should be reasonable variety (at least 8 distinct accents).
    expect(new Set(accents).size).toBeGreaterThanOrEqual(8);
  });
});
