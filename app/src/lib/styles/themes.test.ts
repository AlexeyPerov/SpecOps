import { describe, expect, it } from "vitest";
import {
  getThemeAccentHex,
  getThemeSyntaxPalette,
  type ThemeSyntaxPalette,
} from "./themes";

function accentTiedKeys(): Array<keyof ThemeSyntaxPalette> {
  return ["keyword", "type", "link"];
}

describe("getThemeSyntaxPalette", () => {
  it("ties keyword, type, and link to the theme accent on dark themes", () => {
    const palette = getThemeSyntaxPalette("dark-green");
    const accent = getThemeAccentHex("dark-green");

    expect(palette.keyword).toBe(accent);
    expect(palette.link).not.toBe(palette.keyword);
    expect(palette.type).not.toBe(palette.keyword);
    for (const key of accentTiedKeys()) {
      expect(palette[key].startsWith("#")).toBe(true);
    }
  });

  it("ties keyword, type, and link to the theme accent on light themes", () => {
    const palette = getThemeSyntaxPalette("light-violet");
    const accent = getThemeAccentHex("light-violet");

    expect(palette.keyword).toBe(accent);
    expect(palette.link).toBe(accent);
    expect(palette.type).not.toBe(accent);
  });

  it("keeps non-accent tokens stable across accents in the same mode", () => {
    const darkBlue = getThemeSyntaxPalette("dark-blue");
    const darkGreen = getThemeSyntaxPalette("dark-green");

    expect(darkBlue.comment).toBe(darkGreen.comment);
    expect(darkBlue.string).toBe(darkGreen.string);
    expect(darkBlue.number).toBe(darkGreen.number);
    expect(darkBlue.keyword).not.toBe(darkGreen.keyword);
  });
});
