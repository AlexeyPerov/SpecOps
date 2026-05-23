import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  defaultExternalFilesSettings,
  defaultPersistedSettings,
  loadPersistedSettings,
  savePersistedSettings,
  toExternalFilesSettings,
  toPersistedSettings,
} from "./settingsStore";

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

describe("settings mapping", () => {
  it("round-trips external file settings", () => {
    const persisted = toPersistedSettings({
      theme: "light-violet",
      wrapLines: false,
      zoomPercent: 120,
      externalFiles: {
        watchExternalChanges: false,
        autoReloadCleanFiles: false,
        checkOnWindowFocus: false,
        checkOnTabActivate: true,
      },
      decoratePlaintextSymbols: false,
    });

    expect(toExternalFilesSettings(persisted)).toEqual({
      watchExternalChanges: false,
      autoReloadCleanFiles: false,
      checkOnWindowFocus: false,
      checkOnTabActivate: true,
    });
  });
});

describe("loadPersistedSettings", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
  });

  it("returns parsed settings for a valid file", async () => {
    readTextFileMock.mockResolvedValue(JSON.stringify(defaultPersistedSettings));
    await expect(loadPersistedSettings()).resolves.toEqual(defaultPersistedSettings);
  });

  it("defaults missing external-file booleans", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        theme: "dark-blue",
        wrapLines: true,
        zoomPercent: 100,
      }),
    );

    await expect(loadPersistedSettings()).resolves.toEqual(defaultPersistedSettings);
  });

  it("returns null for invalid theme", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ ...defaultPersistedSettings, theme: "dark-red" }),
    );
    await expect(loadPersistedSettings()).resolves.toBeNull();
  });

  it("maps legacy themeMode/accent to unified theme", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        themeMode: "light",
        accent: "violet",
        wrapLines: true,
        zoomPercent: 100,
      }),
    );
    const result = await loadPersistedSettings();
    expect(result).not.toBeNull();
    expect(result!.theme).toBe("light-violet");
  });

  it("returns null for invalid accent in legacy format", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        themeMode: "dark",
        accent: "red",
        wrapLines: true,
        zoomPercent: 100,
      }),
    );
    await expect(loadPersistedSettings()).resolves.toBeNull();
  });

  it("returns null when wrapLines is missing", async () => {
    const { wrapLines: _wrapLines, ...withoutWrap } = defaultPersistedSettings;
    readTextFileMock.mockResolvedValue(JSON.stringify(withoutWrap));
    await expect(loadPersistedSettings()).resolves.toBeNull();
  });

  it("returns null for corrupt JSON", async () => {
    readTextFileMock.mockResolvedValue("{ not json");
    await expect(loadPersistedSettings()).resolves.toBeNull();
  });

  it("returns null when the settings file is missing", async () => {
    readTextFileMock.mockRejectedValue(new Error("not found"));
    await expect(loadPersistedSettings()).resolves.toBeNull();
  });
});

describe("savePersistedSettings", () => {
  beforeEach(() => {
    writeTextFileMock.mockReset();
    writeTextFileMock.mockResolvedValue(undefined);
  });

  it("writes JSON to the settings path", async () => {
    const settings = {
      ...defaultPersistedSettings,
      watchExternalChanges: false,
    };

    await savePersistedSettings(settings);

    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/settings.json",
      JSON.stringify(settings, null, 2),
    );
  });
});

describe("defaultExternalFilesSettings", () => {
  it("has all toggles enabled by default", () => {
    expect(defaultExternalFilesSettings).toEqual({
      watchExternalChanges: true,
      autoReloadCleanFiles: true,
      checkOnWindowFocus: true,
      checkOnTabActivate: true,
    });
  });
});
