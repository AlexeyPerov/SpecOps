import { describe, expect, it } from "vitest";
import { CURATED_THEMES } from "./curatedThemes";
import { IMPORTED_THEMES } from "./importedThemes";
import { PRESET_REQUIRED_TOKEN_KEYS } from "./themeTokenSchema";

const EXPECTED_IDS = [
  "high-contrast-dark",
  "high-contrast-light",
  "terminal-green",
  "terminal-amber",
];

describe("CURATED_THEMES", () => {
  it("contains the four hand-authored presets", () => {
    const ids = CURATED_THEMES.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(EXPECTED_IDS));
    expect(CURATED_THEMES).toHaveLength(EXPECTED_IDS.length);
  });

  it("has unique ids", () => {
    const ids = CURATED_THEMES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not collide with imported preset ids", () => {
    const importedIds = new Set(IMPORTED_THEMES.map((p) => p.id));
    for (const curated of CURATED_THEMES) {
      expect(importedIds.has(curated.id), `${curated.id} collides with an imported preset`).toBe(
        false,
      );
    }
  });

  it("every preset has all required tokens, a valid baseMode, and a non-empty name", () => {
    for (const preset of CURATED_THEMES) {
      expect(preset.name.trim().length).toBeGreaterThan(0);
      expect(preset.baseMode === "dark" || preset.baseMode === "light").toBe(true);
      for (const key of PRESET_REQUIRED_TOKEN_KEYS) {
        expect(preset.tokens[key], `${preset.id} missing ${key}`).toBeTruthy();
      }
    }
  });

  it("resolves the intended baseMode per archetype", () => {
    const byId = Object.fromEntries(CURATED_THEMES.map((p) => [p.id, p]));
    expect(byId["high-contrast-dark"]?.baseMode).toBe("dark");
    expect(byId["high-contrast-light"]?.baseMode).toBe("light");
    expect(byId["terminal-green"]?.baseMode).toBe("dark");
    expect(byId["terminal-amber"]?.baseMode).toBe("dark");
  });

  it("uses the intended signature colours (background / primary text / accent)", () => {
    const byId = Object.fromEntries(CURATED_THEMES.map((p) => [p.id, p]));
    const token = (id: string, key: "color-bg-root" | "color-text-primary" | "accent-color") =>
      byId[id]!.tokens[key]!;
    expect(token("high-contrast-dark", "color-bg-root").toLowerCase()).toBe("#000000");
    expect(token("high-contrast-dark", "color-text-primary").toLowerCase()).toBe("#ffffff");
    expect(token("high-contrast-dark", "accent-color").toLowerCase()).toBe("#ffff00");

    expect(token("high-contrast-light", "color-bg-root").toLowerCase()).toBe("#ffffff");
    expect(token("high-contrast-light", "color-text-primary").toLowerCase()).toBe("#000000");

    expect(token("terminal-green", "color-bg-root").toLowerCase()).toBe("#000000");
    expect(token("terminal-green", "color-text-primary").toLowerCase()).toBe("#33ff33");

    expect(token("terminal-amber", "color-bg-root").toLowerCase()).toBe("#000000");
    expect(token("terminal-amber", "color-text-primary").toLowerCase()).toBe("#ffb000");
  });
});
