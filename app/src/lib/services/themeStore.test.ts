import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { THEME_TOKEN_KEYS } from "../styles/themeTokens";
import {
  defaultThemeFile,
  loadThemeFile,
  migrateFromLegacySettings,
  normalizeThemeTokens,
  saveThemeFile,
  type ThemeFileV1,
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

  it("migrates from settings.json when theme.json is missing", async () => {
    themeReadOrder(null, JSON.stringify({ theme: "dark-violet", wrapLines: true, zoomPercent: 100 }));
    await expect(loadThemeFile()).resolves.toEqual({
      version: 1,
      activeTheme: { kind: "builtin", id: "dark-amber" },
      customThemes: [],
    });
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    const [path, content] = writeTextFileMock.mock.calls[0];
    expect(path).toBe(THEME_PATH);
    expect(JSON.parse(content as string)).toEqual({
      version: 1,
      activeTheme: { kind: "builtin", id: "dark-amber" },
      customThemes: [],
    });
  });

  it("migrates legacy themeMode/accent from settings.json", async () => {
    themeReadOrder(
      null,
      JSON.stringify({ themeMode: "light", accent: "green", wrapLines: true, zoomPercent: 100 }),
    );
    const result = await loadThemeFile();
    expect(result.activeTheme).toEqual({ kind: "builtin", id: "light-blue" });
  });

  it("returns defaults for invalid theme.json", async () => {
    themeReadOrder("{ not json");
    await expect(loadThemeFile()).resolves.toEqual(defaultThemeFile);
  });

  it("returns defaults for unsupported version", async () => {
    themeReadOrder(JSON.stringify({ version: 2, activeTheme: { kind: "builtin", id: "dark-amber" } }));
    await expect(loadThemeFile()).resolves.toEqual(defaultThemeFile);
  });

  it("loads and normalizes custom themes with partial tokens", async () => {
    themeReadOrder(
      JSON.stringify({
        version: 1,
        activeTheme: { kind: "builtin", id: "dark-amber" },
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

  it("falls back active custom ref when custom theme is missing", async () => {
    themeReadOrder(
      JSON.stringify({
        version: 1,
        activeTheme: { kind: "custom", id: "missing-id" },
        customThemes: [],
      }),
    );
    const result = await loadThemeFile();
    expect(result.activeTheme).toEqual(defaultThemeFile.activeTheme);
  });
});

describe("saveThemeFile", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
    writeTextFileMock.mockResolvedValue(undefined);
  });

  it("writes normalized theme.json with all token keys per custom theme", async () => {
    const input: ThemeFileV1 = {
      version: 1,
      activeTheme: { kind: "builtin", id: "light-blue" },
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
    const saved = JSON.parse(content as string) as ThemeFileV1;
    expect(saved.version).toBe(1);
    expect(saved.activeTheme).toEqual({ kind: "builtin", id: "light-blue" });
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
      version: 1,
      activeTheme: { kind: "builtin", id: "dark-amber" },
      customThemes: [],
    });
    await expect(loadThemeFile()).resolves.toEqual({
      version: 1,
      activeTheme: { kind: "builtin", id: "dark-amber" },
      customThemes: [],
    });
  });
});
