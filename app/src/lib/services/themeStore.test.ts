import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { THEME_TOKEN_KEYS } from "../styles/themeTokens";
import {
  defaultThemeFile,
  loadThemeFile,
  migrateFromLegacySettings,
  normalizeThemeTokens,
  saveThemeFile,
  type ThemeFileV2,
} from "./themeStore";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("./appDataDir", () => ({
  ensureSpecOpsDataDir: vi.fn().mockResolvedValue("/data/spec-ops"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

const readTextFileMock = vi.mocked(readTextFile);
const writeTextFileMock = vi.mocked(writeTextFile);

const THEME_PATH = "/data/spec-ops/theme.json";
const SETTINGS_PATH = "/data/spec-ops/settings.json";

function themeReadOrder(themeContent: string | null, settingsContent?: string): void {
  readTextFileMock.mockImplementation(async (path: string | URL) => {
    const pathKey = String(path);
    if (pathKey === THEME_PATH) {
      if (themeContent === null) {
        throw new Error("missing");
      }
      return themeContent;
    }
    if (pathKey === SETTINGS_PATH && settingsContent !== undefined) {
      return settingsContent;
    }
    throw new Error(`unexpected read: ${pathKey}`);
  });
}

describe("migrateFromLegacySettings", () => {
  it("maps dark accent presets to dark-amber", () => {
    expect(migrateFromLegacySettings("dark-violet")).toEqual({
      kind: "builtin",
      id: "dark-amber",
    });
  });

  it("maps light accent presets to light-blue", () => {
    expect(migrateFromLegacySettings("light-green")).toEqual({
      kind: "builtin",
      id: "light-blue",
    });
  });

  it("passes through built-in ids", () => {
    expect(migrateFromLegacySettings("light-blue")).toEqual({
      kind: "builtin",
      id: "light-blue",
    });
  });

  it("returns null for unrecognized values", () => {
    expect(migrateFromLegacySettings(undefined)).toBeNull();
    expect(migrateFromLegacySettings("neon")).toBeNull();
  });
});

describe("normalizeThemeTokens", () => {
  it("fills missing keys from the base mode built-in defaults", () => {
    const tokens = normalizeThemeTokens("dark", {
      "accent-color": "#ff00ff",
    });
    for (const key of THEME_TOKEN_KEYS) {
      expect(tokens[key].length).toBeGreaterThan(0);
    }
    expect(tokens["accent-color"]).toBe("#ff00ff");
    expect(tokens["color-accent"]).toBe("#ff00ff");
  });

  it("keeps dedicated syntax/text accent overrides", () => {
    const tokens = normalizeThemeTokens("dark", {
      "syntax-keyword": "#112233",
      "syntax-type": "#223344",
      "syntax-link": "#334455",
      "syntax-plaintext-symbol": "#445566",
    });
    expect(tokens["syntax-keyword"]).toBe("#112233");
    expect(tokens["syntax-type"]).toBe("#223344");
    expect(tokens["syntax-link"]).toBe("#334455");
    expect(tokens["syntax-plaintext-symbol"]).toBe("#445566");
  });
});

describe("loadThemeFile", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
    writeTextFileMock.mockResolvedValue(undefined);
  });

  it("returns defaults when theme.json is missing and settings has no theme", async () => {
    readTextFileMock.mockRejectedValue(new Error("missing"));
    await expect(loadThemeFile()).resolves.toEqual(defaultThemeFile);
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  it("seeds from settings.json (dark) when theme.json is missing", async () => {
    themeReadOrder(null, JSON.stringify({ theme: "dark-violet", wrapLines: true, zoomPercent: 100 }));
    await expect(loadThemeFile()).resolves.toEqual({
      version: 2,
      mode: "auto",
      darkTheme: { kind: "builtin", id: "dark-amber" },
      lightTheme: { kind: "builtin", id: "light-blue" },
      manualTheme: { kind: "builtin", id: "dark-amber" },
      customThemes: [],
    });
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    const [path, content] = writeTextFileMock.mock.calls[0];
    expect(path).toBe(THEME_PATH);
    expect(JSON.parse(content as string)).toEqual({
      version: 2,
      mode: "auto",
      darkTheme: { kind: "builtin", id: "dark-amber" },
      lightTheme: { kind: "builtin", id: "light-blue" },
      manualTheme: { kind: "builtin", id: "dark-amber" },
      customThemes: [],
    });
  });

  it("seeds from settings.json (light) into the light slot", async () => {
    themeReadOrder(
      null,
      JSON.stringify({ themeMode: "light", accent: "green", wrapLines: true, zoomPercent: 100 }),
    );
    const result = await loadThemeFile();
    expect(result.lightTheme).toEqual({ kind: "builtin", id: "light-blue" });
    expect(result.darkTheme).toEqual({ kind: "builtin", id: "dark-amber" });
    expect(result.mode).toBe("auto");
  });

  it("returns defaults for invalid theme.json", async () => {
    themeReadOrder("{ not json");
    await expect(loadThemeFile()).resolves.toEqual(defaultThemeFile);
  });

  it("returns defaults for unsupported version (3)", async () => {
    themeReadOrder(JSON.stringify({ version: 3, mode: "auto" }));
    await expect(loadThemeFile()).resolves.toEqual(defaultThemeFile);
  });

  it("defensively seeds a legacy V1 file into V2 (dark active → dark slot)", async () => {
    themeReadOrder(
      JSON.stringify({
        version: 1,
        activeTheme: { kind: "builtin", id: "dark-amber" },
        customThemes: [],
      }),
    );
    const result = await loadThemeFile();
    expect(result.version).toBe(2);
    expect(result.mode).toBe("auto");
    expect(result.darkTheme).toEqual({ kind: "builtin", id: "dark-amber" });
    expect(result.lightTheme).toEqual({ kind: "builtin", id: "light-blue" });
  });

  it("defensively seeds a legacy V1 file into V2 (light active → light slot)", async () => {
    themeReadOrder(
      JSON.stringify({
        version: 1,
        activeTheme: { kind: "builtin", id: "light-blue" },
        customThemes: [],
      }),
    );
    const result = await loadThemeFile();
    expect(result.darkTheme).toEqual({ kind: "builtin", id: "dark-amber" });
    expect(result.lightTheme).toEqual({ kind: "builtin", id: "light-blue" });
  });

  it("loads a V2 file verbatim", async () => {
    themeReadOrder(
      JSON.stringify({
        version: 2,
        mode: "manual",
        darkTheme: { kind: "preset", id: "darkside" },
        lightTheme: { kind: "builtin", id: "light-blue" },
        manualTheme: { kind: "preset", id: "github" },
        customThemes: [],
      }),
    );
    const result = await loadThemeFile();
    expect(result).toEqual({
      version: 2,
      mode: "manual",
      darkTheme: { kind: "preset", id: "darkside" },
      lightTheme: { kind: "builtin", id: "light-blue" },
      manualTheme: { kind: "preset", id: "github" },
      customThemes: [],
    });
  });

  it("loads and normalizes custom themes with partial tokens", async () => {
    themeReadOrder(
      JSON.stringify({
        version: 2,
        mode: "auto",
        darkTheme: { kind: "builtin", id: "dark-amber" },
        lightTheme: { kind: "builtin", id: "light-blue" },
        customThemes: [
          {
            id: "custom-1",
            name: "Partial",
            baseMode: "dark",
            tokens: { "accent-color": "#112233" },
          },
        ],
      }),
    );
    const result = await loadThemeFile();
    expect(result.customThemes).toHaveLength(1);
    expect(result.customThemes[0].tokens["accent-color"]).toBe("#112233");
    for (const key of THEME_TOKEN_KEYS) {
      expect(result.customThemes[0].tokens[key].length).toBeGreaterThan(0);
    }
  });

  it("falls back dark slot to default when custom ref is missing", async () => {
    themeReadOrder(
      JSON.stringify({
        version: 2,
        mode: "dark",
        darkTheme: { kind: "custom", id: "missing-id" },
        lightTheme: { kind: "builtin", id: "light-blue" },
        customThemes: [],
      }),
    );
    const result = await loadThemeFile();
    expect(result.darkTheme).toEqual({ kind: "builtin", id: "dark-amber" });
  });

  it("round-trips a known preset darkTheme ref through load", async () => {
    themeReadOrder(
      JSON.stringify({
        version: 2,
        mode: "auto",
        darkTheme: { kind: "preset", id: "darkside" },
        lightTheme: { kind: "builtin", id: "light-blue" },
        customThemes: [],
      }),
    );
    const result = await loadThemeFile();
    expect(result.darkTheme).toEqual({ kind: "preset", id: "darkside" });
  });

  it("falls back to default builtin when preset id is unknown (future-version safety)", async () => {
    themeReadOrder(
      JSON.stringify({
        version: 2,
        mode: "auto",
        darkTheme: { kind: "preset", id: "removed-in-future" },
        lightTheme: { kind: "builtin", id: "light-blue" },
        customThemes: [],
      }),
    );
    const result = await loadThemeFile();
    expect(result.darkTheme).toEqual({ kind: "builtin", id: "dark-amber" });
  });
});

describe("saveThemeFile", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
    writeTextFileMock.mockResolvedValue(undefined);
  });

  it("writes normalized theme.json with all token keys per custom theme", async () => {
    const input: ThemeFileV2 = {
      version: 2,
      mode: "manual",
      darkTheme: { kind: "builtin", id: "dark-amber" },
      lightTheme: { kind: "builtin", id: "light-blue" },
      manualTheme: { kind: "builtin", id: "light-blue" },
      customThemes: [
        {
          id: "c1",
          name: "Test",
          baseMode: "light",
          tokens: normalizeThemeTokens("light", { "accent-color": "#aabbcc" }),
        },
      ],
    };

    await saveThemeFile(input);

    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    const [path, content] = writeTextFileMock.mock.calls[0];
    expect(path).toBe(THEME_PATH);
    const saved = JSON.parse(content as string) as ThemeFileV2;
    expect(saved.version).toBe(2);
    expect(saved.lightTheme).toEqual({ kind: "builtin", id: "light-blue" });
    expect(saved.customThemes[0].tokens["accent-color"]).toBe("#aabbcc");
    for (const key of THEME_TOKEN_KEYS) {
      expect(saved.customThemes[0].tokens[key]).toBeTruthy();
    }
  });

  it("round-trips through load after save content is written", async () => {
    let storedTheme: string | null = null;
    readTextFileMock.mockImplementation(async (path: string | URL) => {
      if (String(path) === THEME_PATH) {
        if (storedTheme === null) {
          throw new Error("missing");
        }
        return storedTheme;
      }
      throw new Error(`unexpected: ${String(path)}`);
    });
    writeTextFileMock.mockImplementation(async (_path, content) => {
      storedTheme = content as string;
    });

    await saveThemeFile({
      version: 2,
      mode: "auto",
      darkTheme: { kind: "builtin", id: "dark-amber" },
      lightTheme: { kind: "builtin", id: "light-blue" },
      manualTheme: { kind: "builtin", id: "dark-amber" },
      customThemes: [],
    });
    await expect(loadThemeFile()).resolves.toEqual({
      version: 2,
      mode: "auto",
      darkTheme: { kind: "builtin", id: "dark-amber" },
      lightTheme: { kind: "builtin", id: "light-blue" },
      manualTheme: { kind: "builtin", id: "dark-amber" },
      customThemes: [],
    });
  });
});
