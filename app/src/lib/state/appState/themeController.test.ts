import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORTED_THEMES } from "../../styles/importedThemes";
import {
  DEFAULT_BUILTIN_THEME,
  resolveBuiltinTokens,
} from "../../styles/themeTokens";
import type { AppThemeState } from "../../domain/contracts";
import {
  applyThemeState,
  baseModeForRef,
  resolveActiveTheme,
  resolveTokensForRef,
  setSystemPrefersDark,
  subscribeSystemColorScheme,
} from "./themeController";
import type { ActiveThemeRef } from "../../services/themeStore";

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

function buildTheme(overrides: Partial<AppThemeState> = {}): AppThemeState {
  return {
    mode: "auto",
    darkTheme: { kind: "builtin", id: "dark-amber" },
    lightTheme: { kind: "builtin", id: "light-blue" },
    manualTheme: { kind: "builtin", id: "dark-amber" },
    customThemes: [],
    ...overrides,
  };
}

describe("resolveActiveTheme", () => {
  it("returns manualTheme in manual mode regardless of OS pref", () => {
    const theme = buildTheme({ mode: "manual" });
    expect(resolveActiveTheme(theme, false)).toEqual(theme.manualTheme);
    expect(resolveActiveTheme(theme, true)).toEqual(theme.manualTheme);
  });

  it("returns darkTheme in auto mode when OS prefers dark", () => {
    const theme = buildTheme({ mode: "auto" });
    expect(resolveActiveTheme(theme, true)).toEqual(theme.darkTheme);
  });

  it("returns lightTheme in auto mode when OS prefers light", () => {
    const theme = buildTheme({ mode: "auto" });
    expect(resolveActiveTheme(theme, false)).toEqual(theme.lightTheme);
  });

  it("respects distinct dark/light preset refs in auto mode", () => {
    const darkside = IMPORTED_THEMES.find((p) => p.id === "darkside");
    const github = IMPORTED_THEMES.find((p) => p.id === "github");
    if (!darkside || !github) {
      return;
    }
    const theme = buildTheme({
      mode: "auto",
      darkTheme: { kind: "preset", id: "darkside" },
      lightTheme: { kind: "preset", id: "github" },
    });
    expect(resolveActiveTheme(theme, true)).toEqual({ kind: "preset", id: "darkside" });
    expect(resolveActiveTheme(theme, false)).toEqual({ kind: "preset", id: "github" });
  });
});

describe("applyThemeState — preset kind", () => {
  beforeEach(() => {
    const root = createMockRoot();
    globalThis.document = { documentElement: root } as unknown as Document;
  });

  afterEach(() => {
    globalThis.document = REAL_DOCUMENT as Document;
  });

  it("applies a known dark preset's tokens to the DOM when auto + OS dark", () => {
    const darkside = IMPORTED_THEMES.find((p) => p.id === "darkside");
    if (!darkside) {
      return;
    }
    const theme = buildTheme({
      mode: "auto",
      darkTheme: { kind: "preset", id: "darkside" },
    });
    setSystemPrefersDark(true);
    applyThemeState(theme, true);

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
    const theme = buildTheme({
      mode: "manual",
      manualTheme: { kind: "preset", id: "removed-in-a-future-version" },
    });
    applyThemeState(theme, true);

    const root = document.documentElement;
    const fallback = resolveBuiltinTokens(DEFAULT_BUILTIN_THEME);
    expect(root.style.getPropertyValue("--accent-color")).toBe(
      fallback["accent-color"],
    );
  });
});

describe("baseModeForRef", () => {
  it("resolves builtin dark/light by id prefix", () => {
    const customThemes: never[] = [];
    expect(baseModeForRef({ kind: "builtin", id: "dark-amber" }, customThemes)).toBe("dark");
    expect(baseModeForRef({ kind: "builtin", id: "light-blue" }, customThemes)).toBe("light");
  });

  it("returns the preset's declared baseMode", () => {
    const github = IMPORTED_THEMES.find((p) => p.id === "github");
    if (!github) {
      return;
    }
    expect(baseModeForRef({ kind: "preset", id: "github" }, [])).toBe("light");
  });

  it("falls back to dark when a preset id is unknown", () => {
    expect(baseModeForRef({ kind: "preset", id: "nope" }, [])).toBe("dark");
  });

  it("returns a custom theme's baseMode", () => {
    const ref: ActiveThemeRef = { kind: "custom", id: "c1" };
    const customThemes = [
      { id: "c1", name: "Mine", baseMode: "light" as const, tokens: {} as never },
    ];
    expect(baseModeForRef(ref, customThemes)).toBe("light");
  });
});

describe("subscribeSystemColorScheme", () => {
  it("returns a no-op unlisten when matchMedia is unavailable", () => {
    const original = globalThis.window;
    // @ts-expect-error — simulate a windowless env (jsdom without matchMedia)
    delete globalThis.window;
    const unlisten = subscribeSystemColorScheme(() => {});
    expect(typeof unlisten).toBe("function");
    expect(() => unlisten()).not.toThrow();
    globalThis.window = original;
  });

  it("invokes the callback on change and stops after unlisten", () => {
    const handlers: ((event: MediaQueryListEvent) => void)[] = [];
    const removeSpy = vi.fn();
    const addSpy = vi.fn((_: string, handler: (event: MediaQueryListEvent) => void) => {
      handlers.push(handler);
    });
    const mq = {
      matches: false,
      addEventListener: addSpy,
      removeEventListener: removeSpy,
    };
    const originalMatchMedia = globalThis.window?.matchMedia;
    (globalThis.window as unknown as { matchMedia: unknown }).matchMedia = () => mq;
    try {
      const onChange = vi.fn();
      const unlisten = subscribeSystemColorScheme(onChange);
      expect(addSpy).toHaveBeenCalledWith("change", expect.any(Function));

      // Simulate OS switching to dark.
      const handler = handlers[0]!;
      handler({ matches: true } as MediaQueryListEvent);
      expect(onChange).toHaveBeenCalledWith(true);

      unlisten();
      expect(removeSpy).toHaveBeenCalledWith("change", expect.any(Function));
      } finally {
      if (originalMatchMedia) {
        (globalThis.window as unknown as { matchMedia: unknown }).matchMedia =
          originalMatchMedia;
      }
    }
  });
});

describe("resolveTokensForRef", () => {
  it("returns the procedurally-resolved tokens for a builtin ref", () => {
    const tokens = resolveTokensForRef({ kind: "builtin", id: "dark-amber" }, []);
    expect(tokens["accent-color"]).toBe(
      resolveBuiltinTokens("dark-amber")["accent-color"],
    );
    // Builtins resolve a full token map, not an empty object.
    expect(tokens["color-bg-root"].length).toBeGreaterThan(0);
  });

  it("returns the preset tokens merged over the matching-mode builtin defaults", () => {
    const darkside = IMPORTED_THEMES.find((p) => p.id === "darkside");
    if (!darkside) {
      return;
    }
    const tokens = resolveTokensForRef({ kind: "preset", id: "darkside" }, []);
    // Preset-provided keys override the builtin base…
    expect(tokens["color-bg-root"]).toBe(darkside.tokens["color-bg-root"]);
    expect(tokens["accent-color"]).toBe(darkside.tokens["accent-color"]);
    // …and state tokens the preset omits are inherited from the dark builtin.
    expect(tokens["color-danger"]).toBe(resolveBuiltinTokens("dark-amber")["color-danger"]);
    expect(tokens["color-success"]).toBe(resolveBuiltinTokens("dark-amber")["color-success"]);
  });

  it("returns the inline token map for a custom ref", () => {
    const customTokens = { ...resolveBuiltinTokens("light-blue"), "accent-color": "#abcdef" };
    const customThemes = [
      { id: "c1", name: "Mine", baseMode: "light" as const, tokens: customTokens },
    ];
    const tokens = resolveTokensForRef({ kind: "custom", id: "c1" }, customThemes);
    expect(tokens["accent-color"]).toBe("#abcdef");
  });

  it("falls back to the matching-mode builtin for an unknown preset id", () => {
    // Unknown preset → baseModeForRef returns "dark" → fallback builtin dark-amber.
    const tokens = resolveTokensForRef({ kind: "preset", id: "removed" }, []);
    expect(tokens["accent-color"]).toBe(resolveBuiltinTokens("dark-amber")["accent-color"]);
  });

  it("falls back to the matching-mode builtin for an unknown custom id", () => {
    const tokens = resolveTokensForRef({ kind: "custom", id: "nope" }, []);
    expect(tokens["accent-color"]).toBe(resolveBuiltinTokens("dark-amber")["accent-color"]);
  });
});
