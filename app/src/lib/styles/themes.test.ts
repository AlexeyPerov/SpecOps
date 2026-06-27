import { describe, expect, it } from "vitest";
import {
  applyBuiltinTheme,
  applyCustomTheme,
  clearThemeOverrides,
  extractSolidColor,
  getBuiltinAccentHex,
  getThemeSyntaxPalette,
  GRADIENT_CAPABLE_KEYS,
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

  it("writes a <key>-solid var for gradient-capable tokens (mirrors solid value)", () => {
    const root = createMockRoot();
    const tokens = resolveBuiltinTokens("dark-amber");
    applyCustomTheme({ baseMode: "dark", tokens }, root);

    for (const key of GRADIENT_CAPABLE_KEYS) {
      expect(root.style.getPropertyValue(`--${key}-solid`)).toBe(tokens[key]);
    }
  });

  it("extracts the first color stop of a gradient into the -solid var", () => {
    const root = createMockRoot();
    const tokens = resolveBuiltinTokens("dark-amber");
    tokens["color-bg-root"] = "linear-gradient(#1a1a2e, #16213e)";

    applyCustomTheme({ baseMode: "dark", tokens }, root);

    // The gradient value is preserved verbatim on the main var…
    expect(root.style.getPropertyValue("--color-bg-root")).toBe(
      "linear-gradient(#1a1a2e, #16213e)",
    );
    // …and the solid fallback is the first stop so color-mix derivatives resolve.
    expect(root.style.getPropertyValue("--color-bg-root-solid")).toBe("#1a1a2e");
  });

  it("does not write -solid vars for non-gradient-capable tokens", () => {
    const root = createMockRoot();
    const tokens = resolveBuiltinTokens("dark-amber");
    applyCustomTheme({ baseMode: "dark", tokens }, root);

    expect(root.style.getPropertyValue("--accent-color-solid")).toBe("");
    expect(root.style.getPropertyValue("--syntax-keyword-solid")).toBe("");
    expect(root.style.getPropertyValue("--color-text-primary-solid")).toBe("");
  });
});

describe("applyBuiltinTheme", () => {
  it("mirrors -solid vars for gradient-capable tokens so surface derivatives resolve", () => {
    const root = createMockRoot();
    applyBuiltinTheme("dark-amber", root);
    for (const key of GRADIENT_CAPABLE_KEYS) {
      expect(root.style.getPropertyValue(`--${key}-solid`)).toBeTruthy();
    }
  });
});

describe("extractSolidColor", () => {
  it("passes through solid colors unchanged", () => {
    expect(extractSolidColor("#1a1a2e")).toBe("#1a1a2e");
    expect(extractSolidColor("rgba(10, 20, 30, 0.5)")).toBe("rgba(10, 20, 30, 0.5)");
    expect(extractSolidColor("rgb(255 0 0)")).toBe("rgb(255 0 0)");
  });

  it("extracts the first hex stop from a linear gradient", () => {
    expect(extractSolidColor("linear-gradient(#1a1a2e, #16213e)")).toBe("#1a1a2e");
    expect(extractSolidColor("linear-gradient(90deg, #ff0000, #00ff00)")).toBe("#ff0000");
  });

  it("extracts an rgba stop from a radial gradient", () => {
    expect(extractSolidColor("radial-gradient(rgba(1,2,3,0.4), #000)")).toBe(
      "rgba(1,2,3,0.4)",
    );
  });

  it("falls back to #000000 for a gradient with no parseable color", () => {
    expect(extractSolidColor("linear-gradient(transparent, transparent)")).toBe("#000000");
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
