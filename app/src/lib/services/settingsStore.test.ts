/** Theme persistence and migration are covered in `themeStore.test.ts`. */
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
      wrapLines: false,
      zoomPercent: 120,
      externalFiles: {
        watchExternalChanges: false,
        autoReloadCleanFiles: false,
        checkOnWindowFocus: false,
        checkOnTabActivate: true,
      },
      decoratePlaintextSymbols: false,
      hideActivityRailWhenNotepadOnly: true,
      debugProvider: {
        enabled: true,
        simulationSeed: 7,
        delayMsMin: 100,
        delayMsMax: 900,
        chunkCharsMin: 4,
        chunkCharsMax: 20,
        failureProbability: 0.1,
        failureMessage: "Test failure",
        includeDiagnostics: false,
      },
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
        wrapLines: true,
        zoomPercent: 100,
      }),
    );

    await expect(loadPersistedSettings()).resolves.toEqual(defaultPersistedSettings);
  });

  it("defaults missing debug provider settings", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        wrapLines: true,
        zoomPercent: 100,
      }),
    );

    await expect(loadPersistedSettings()).resolves.toEqual(defaultPersistedSettings);
  });

  it("normalizes invalid debug provider ranges on load", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        ...defaultPersistedSettings,
        debugProvider: {
          enabled: true,
          simulationSeed: null,
          delayMsMin: 5000,
          delayMsMax: 100,
          chunkCharsMin: 64,
          chunkCharsMax: 8,
          failureProbability: 3,
          failureMessage: "Fail",
          includeDiagnostics: true,
        },
      }),
    );

    const result = await loadPersistedSettings();
    expect(result?.debugProvider).toEqual({
      enabled: true,
      simulationSeed: null,
      delayMsMin: 5000,
      delayMsMax: 5000,
      chunkCharsMin: 64,
      chunkCharsMax: 64,
      failureProbability: 1,
      failureMessage: "Fail",
      includeDiagnostics: true,
    });
  });

  it("ignores legacy theme field without failing load", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ ...defaultPersistedSettings, theme: "dark-red" }),
    );
    const result = await loadPersistedSettings();
    expect(result).toEqual(defaultPersistedSettings);
    expect(result).not.toHaveProperty("theme");
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
