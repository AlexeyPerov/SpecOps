import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IMPORTED_THEMES } from "../../styles/importedThemes";
import {
  DEFAULT_BUILTIN_THEME,
  resolveBuiltinTokens,
} from "../../styles/themeTokens";
import type { AppThemeState } from "../../domain/contracts";
import { applyThemeState, baseModeForTheme } from "./themeController";

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

const REAL_DOCUMENT = globalThis.document;

describe("applyThemeState — preset kind", () => {
  beforeEach(() => {
    // The real `document` is not available in the node test env; stand up a
    // minimal stub so applyThemeState's `document.documentElement` resolves to
    // a tracked mock root whose setProperty/removeProperty calls we assert on.
    const root = createMockRoot();
    globalThis.document = { documentElement: root } as unknown as Document;
  });

  afterEach(() => {
    globalThis.document = REAL_DOCUMENT as Document;
  });

  it("applies a known preset's tokens to the DOM", () => {
    const darkside = IMPORTED_THEMES.find((p) => p.id === "darkside");
    if (!darkside) {
      // Skip if the curated set changes shape; the catalog test covers existence.
      return;
    }
    const theme: AppThemeState = {
      activeTheme: { kind: "preset", id: "darkside" },
      customThemes: [],
    };
    applyThemeState(theme);

    const root = document.documentElement;
    expect(root.dataset.theme).toBe(darkside.baseMode);
    expect(root.style.getPropertyValue("--color-bg-root")).toBe(
      darkside.tokens["color-bg-root"],
    );
    expect(root.style.getPropertyValue("--accent-color")).toBe(
      darkside.tokens["accent-color"],
    );
  });

  it("falls back to the default builtin theme when a preset id is unknown", () => {
    const theme: AppThemeState = {
      activeTheme: { kind: "preset", id: "removed-in-a-future-version" },
      customThemes: [],
    };
    applyThemeState(theme);

    const root = document.documentElement;
    const fallback = resolveBuiltinTokens(DEFAULT_BUILTIN_THEME);
    expect(root.style.getPropertyValue("--accent-color")).toBe(
      fallback["accent-color"],
    );
  });
});

describe("baseModeForTheme — preset kind", () => {
  it("returns the preset's declared baseMode", () => {
    const github = IMPORTED_THEMES.find((p) => p.id === "github");
    if (!github) {
      return;
    }
    const theme: AppThemeState = {
      activeTheme: { kind: "preset", id: "github" },
      customThemes: [],
    };
    expect(baseModeForTheme(theme)).toBe("light");
  });

  it("falls back to dark when a preset id is unknown", () => {
    const theme: AppThemeState = {
      activeTheme: { kind: "preset", id: "nope" },
      customThemes: [],
    };
    expect(baseModeForTheme(theme)).toBe("dark");
  });
});
