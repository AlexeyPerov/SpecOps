import { describe, expect, it } from "vitest";
import {
  applyBuiltinTheme,
  applyCustomTheme,
  clearThemeOverrides,
  getBuiltinAccentHex,
  getThemeSyntaxPalette,
  resolveBuiltinTokens,
  snapshotThemeTokens,
  THEME_TOKEN_GROUPS,
  THEME_TOKEN_KEYS,
  type BuiltinThemeId,
  type ThemeSyntaxPalette,
  type ThemeTokenKey,
} from "./themeTokens";

function accentTiedKeys(): Array<keyof ThemeSyntaxPalette> {
  return ["keyword", "type", "link", "plaintext-symbol"];
}

function createMockRoot(): HTMLElement {
  const properties = new Map<string, string>();
  const el = {
    dataset: {} as DOMStringMap,
    style: {
      setProperty(name: string, value: string) {
        properties.set(name, value);
      },
      removeProperty(name: string) {
        properties.delete(name);
        return "";
      },
      getPropertyValue(name: string) {
        return properties.get(name) ?? "";
      },
    },
  };
  return el as unknown as HTMLElement;
}

describe("THEME_TOKEN_KEYS", () => {
  it("lists exactly 29 keys in seven groups", () => {
    expect(THEME_TOKEN_KEYS).toHaveLength(29);
    const grouped = THEME_TOKEN_GROUPS.flatMap((group) => group.keys);
    expect(new Set(grouped).size).toBe(29);
    expect([...THEME_TOKEN_KEYS].sort()).toEqual([...grouped].sort());
  });
});

describe("resolveBuiltinTokens", () => {
  it.each<BuiltinThemeId>(["dark-amber", "light-blue"])(
    "returns all 29 non-empty token values for %s",
    (id) => {
      const tokens = resolveBuiltinTokens(id);
      for (const key of THEME_TOKEN_KEYS) {
        expect(tokens[key as ThemeTokenKey].length).toBeGreaterThan(0);
      }
      expect(tokens["accent-color"]).toBe(getBuiltinAccentHex(id));
    },
  );
});

describe("getThemeSyntaxPalette", () => {
  it("ties keyword, type, and link to the theme accent on dark-amber", () => {
    const palette = getThemeSyntaxPalette("dark-amber");
    const accent = getBuiltinAccentHex("dark-amber");

    expect(palette.keyword).toBe(accent);
    expect(palette.link).not.toBe(palette.keyword);
    expect(palette.type).not.toBe(palette.keyword);
    for (const key of accentTiedKeys()) {
      expect(palette[key].startsWith("#")).toBe(true);
    }
  });

  it("ties keyword, type, and link to the theme accent on light-blue", () => {
    const palette = getThemeSyntaxPalette("light-blue");
    const accent = getBuiltinAccentHex("light-blue");

    expect(palette.keyword).toBe(accent);
    expect(palette.link).toBe(accent);
    expect(palette.type).not.toBe(accent);
  });

  it("keeps non-accent syntax tokens stable across built-ins in the same mode", () => {
    const darkAmber = getThemeSyntaxPalette("dark-amber");
    const darkResolved = resolveBuiltinTokens("dark-amber");

    expect(darkAmber.comment).toBe(darkResolved["syntax-comment"]);
    expect(darkAmber.string).toBe(darkResolved["syntax-string"]);
    expect(darkAmber.keyword).toBe(getBuiltinAccentHex("dark-amber"));
  });
});

describe("applyBuiltinTheme", () => {
  it("sets mode, accent, syntax, and clears UI overrides for dark-amber", () => {
    const root = createMockRoot();
    root.style.setProperty("--color-bg-root", "#111111");
    applyBuiltinTheme("dark-amber", root);

    expect(root.dataset.theme).toBe("dark");
    expect(root.style.getPropertyValue("--color-bg-root")).toBe("");
    expect(root.style.getPropertyValue("--accent-color")).toBe("#d97706");
    expect(root.style.getPropertyValue("--color-accent")).toBe("#d97706");
    expect(root.style.getPropertyValue("--syntax-keyword")).toBe("#d97706");
  });

  it("sets light mode for light-blue", () => {
    const root = createMockRoot();
    applyBuiltinTheme("light-blue", root);

    expect(root.dataset.theme).toBe("light");
    expect(root.style.getPropertyValue("--accent-color")).toBe("#2376ff");
  });
});

describe("clearThemeOverrides", () => {
  it("removes every theme token inline property", () => {
    const root = createMockRoot();
    for (const key of THEME_TOKEN_KEYS) {
      root.style.setProperty(`--${key}`, "#000000");
    }
    clearThemeOverrides(root);
    for (const key of THEME_TOKEN_KEYS) {
      expect(root.style.getPropertyValue(`--${key}`)).toBe("");
    }
  });
});

describe("applyCustomTheme", () => {
  it("sets data-theme and all token properties", () => {
    const root = createMockRoot();
    const tokens = resolveBuiltinTokens("light-blue");
    tokens["color-bg-root"] = "#abcdef";

    applyCustomTheme({ baseMode: "light", tokens }, root);

    expect(root.dataset.theme).toBe("light");
    for (const key of THEME_TOKEN_KEYS) {
      expect(root.style.getPropertyValue(`--${key}`)).toBe(tokens[key]);
    }
    expect(root.style.getPropertyValue("--color-accent")).toBe(tokens["accent-color"]);
  });
});

describe("snapshotThemeTokens", () => {
  it("returns resolved values from inline styles with builtin fallback for empty computed", () => {
    const root = createMockRoot();
    applyCustomTheme({
      baseMode: "dark",
      tokens: resolveBuiltinTokens("dark-amber"),
    }, root);

    const snapshot = snapshotThemeTokens(root, "dark-amber");
    expect(snapshot["accent-color"]).toBe("#d97706");
    expect(Object.keys(snapshot)).toHaveLength(29);
  });
});
