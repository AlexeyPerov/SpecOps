/** Theme persistence and migration are covered in `themeStore.test.ts`. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { defaultAppProviderSettings } from "../ai/providers/appProviderSettings";
import {
  defaultHttpConnection,
  DEFAULT_HTTP_CONNECTION_ID,
} from "../ai/providers/httpConnectionSettings";
import {
  defaultExternalFilesSettings,
  defaultPersistedSettings,
  loadPersistedSettings,
  savePersistedSettings,
  toExternalFilesSettings,
  toPersistedSettings,
} from "./settingsStore";
import { defaultProviderModelCatalogs } from "../ai/providers/providerModelCatalog";
import { defaultChatModesSettings } from "../ai/modes/chatModesSettings";
import { defaultOpencodeSettings } from "./opencodeSettings";
import { defaultLogSettings } from "./logSettings";
import { defaultFontSettings } from "./fontSettings";
import {
  defaultOsNotificationSettings,
  defaultSoundSettings,
} from "./notificationSettings";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("./appDataDir", () => ({
  ensureSpecOpsDataDir: vi.fn().mockResolvedValue("/data/spec-ops"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

const readTextFileMock = vi.mocked(readTextFile);
const writeTextFileMock = vi.mocked(writeTextFile);
const renameMock = vi.mocked(rename);
const removeMock = vi.mocked(remove);

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
        maxBinaryOpenAsTextBytes: 200 * 1024,
        maxOpenWithoutConfirmBytes: 512 * 1024,
      },
      decoratePlaintextSymbols: false,
      defaultMarkdownViewMode: "split",
      showMinimap: false,
      showFoldGutter: true,
      autoClosePairs: true,
      autoSuggest: false,
      restrictFilesToContext: false,
      opencode: defaultOpencodeSettings,
      chatHttp: { enabled: false },
      gitIntegration: defaultPersistedSettings.gitIntegration,
      logSettings: { ...defaultLogSettings, verboseProviderLogging: false },
      chatModes: defaultChatModesSettings,
      markdownSnippets: defaultPersistedSettings.markdownSnippets,
      providerSettings: {
        httpConnections: [
          {
            ...defaultHttpConnection,
            id: DEFAULT_HTTP_CONNECTION_ID,
            label: "HTTP",
            enabled: true,
            baseUrl: "https://example.test/v1",
          },
        ],
        defaultConnectionId: DEFAULT_HTTP_CONNECTION_ID,
        debugChat: {
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
        debugWorkspace: {
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
        http: {
          enabled: true,
          baseUrl: "https://example.test/v1",
        },
      },
      providerModelCatalogs: {
        http: {
          modelIds: ["gpt-test"],
          defaultModelId: "gpt-test",
        },
      },
      commandBindingOverrides: {},
      fontSettings: { ...defaultFontSettings },
      soundSettings: { ...defaultSoundSettings },
      osNotificationSettings: { ...defaultOsNotificationSettings },
    });

    expect(toExternalFilesSettings(persisted)).toEqual({
      watchExternalChanges: false,
      autoReloadCleanFiles: false,
      checkOnWindowFocus: false,
      checkOnTabActivate: true,
      maxBinaryOpenAsTextBytes: 200 * 1024,
      maxOpenWithoutConfirmBytes: 512 * 1024,
    });
    expect(persisted.autoClosePairs).toBe(true);
    expect(persisted.autoSuggest).toBe(false);
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

  it("defaults missing provider settings", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        wrapLines: true,
        zoomPercent: 100,
      }),
    );

    const result = await loadPersistedSettings();
    expect(result?.providerSettings).toEqual(defaultAppProviderSettings);
    expect(result?.providerModelCatalogs).toEqual(defaultProviderModelCatalogs);
    expect(result?.opencode).toEqual(defaultOpencodeSettings);
  });

      it("retains default catalogs when provider catalogs are missing", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        wrapLines: true,
        zoomPercent: 100,
        providerSettings: {
          http: {
            enabled: true,
            baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          },
        },
      }),
    );

    const result = await loadPersistedSettings();
    expect(result?.providerModelCatalogs).toEqual(defaultProviderModelCatalogs);
    expect(result?.providerSettings.http.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(result?.providerSettings.httpConnections?.[0]?.baseUrl).toBe(
      "https://open.bigmodel.cn/api/paas/v4",
    );
  });

  it("normalizes invalid provider model catalogs on load", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        ...defaultPersistedSettings,
        providerModelCatalogs: {
          http: {
            modelIds: ["", "gpt-custom", "gpt-custom"],
            defaultModelId: "missing",
          },
        },
      }),
    );

    const result = await loadPersistedSettings();
    expect(result?.providerModelCatalogs?.http).toEqual({
      modelIds: ["gpt-custom"],
      defaultModelId: "gpt-custom",
    });
  });

  it("normalizes invalid debug provider ranges on load", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        ...defaultPersistedSettings,
        providerSettings: {
          http: defaultAppProviderSettings.http,
          debug: {
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
        },
      }),
    );

    const result = await loadPersistedSettings();
    expect(result?.providerSettings.debugChat).toEqual({
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
    expect(result?.providerSettings.debugWorkspace).toEqual({
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

  it("defaults wrapLines when missing instead of discarding the whole file", async () => {
    const { wrapLines: _wrapLines, ...withoutWrap } = defaultPersistedSettings;
    readTextFileMock.mockResolvedValue(JSON.stringify(withoutWrap));
    // A missing/renamed field must not return null: that would boot on
    // defaults and overwrite settings.json, losing every other setting.
    await expect(loadPersistedSettings()).resolves.toEqual(defaultPersistedSettings);
  });

  it("preserves other settings when zoomPercent is missing", async () => {
    const { zoomPercent: _zoom, ...withoutZoom } = defaultPersistedSettings;
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ ...withoutZoom, wrapLines: false, showMinimap: false }),
    );
    const result = await loadPersistedSettings();
    expect(result?.zoomPercent).toBe(defaultPersistedSettings.zoomPercent);
    expect(result?.wrapLines).toBe(false);
    expect(result?.showMinimap).toBe(false);
  });

  it("clamps out-of-range zoomPercent and rejects NaN", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ ...defaultPersistedSettings, zoomPercent: 10_000 }),
    );
    await expect(loadPersistedSettings()).resolves.toMatchObject({ zoomPercent: 220 });

    readTextFileMock.mockResolvedValue(
      JSON.stringify({ ...defaultPersistedSettings, zoomPercent: 1 }),
    );
    await expect(loadPersistedSettings()).resolves.toMatchObject({ zoomPercent: 60 });

    // JSON has no NaN literal, but a hand-edited "null" hits the same guard.
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ ...defaultPersistedSettings, zoomPercent: null }),
    );
    await expect(loadPersistedSettings()).resolves.toMatchObject({
      zoomPercent: defaultPersistedSettings.zoomPercent,
    });
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
    renameMock.mockReset();
    renameMock.mockResolvedValue(undefined);
    removeMock.mockReset();
    removeMock.mockResolvedValue(undefined);
  });

  it("writes JSON to a temp file and renames it over the settings path", async () => {
    const settings = {
      ...defaultPersistedSettings,
      watchExternalChanges: false,
    };

    await savePersistedSettings(settings);

    const [tempPath, content] = writeTextFileMock.mock.calls[0] ?? [];
    expect(String(tempPath)).toMatch(/^\/data\/spec-ops\/settings\.json\..+\.tmp$/);
    expect(content).toBe(JSON.stringify(settings, null, 2));
    expect(renameMock).toHaveBeenCalledWith(tempPath, "/data/spec-ops/settings.json");
  });

  it("falls back to a direct write when rename fails", async () => {
    renameMock.mockRejectedValue(new Error("rename unsupported"));
    const settings = { ...defaultPersistedSettings };

    await savePersistedSettings(settings);

    expect(writeTextFileMock).toHaveBeenLastCalledWith(
      "/data/spec-ops/settings.json",
      JSON.stringify(settings, null, 2),
    );
  });

  it("serializes overlapping saves so writes never interleave", async () => {
    const order: string[] = [];
    let releaseFirstWrite: () => void = () => {};
    writeTextFileMock.mockImplementationOnce(async () => {
      order.push("write-1-start");
      await new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
      });
      order.push("write-1-end");
    });
    writeTextFileMock.mockImplementationOnce(async () => {
      order.push("write-2");
    });

    const first = savePersistedSettings({ ...defaultPersistedSettings });
    const second = savePersistedSettings({ ...defaultPersistedSettings, wrapLines: false });
    await vi.waitFor(() => {
      expect(order).toContain("write-1-start");
    });
    releaseFirstWrite();
    await Promise.all([first, second]);

    expect(order).toEqual(["write-1-start", "write-1-end", "write-2"]);
  });
});

describe("defaultExternalFilesSettings", () => {
  it("has all toggles enabled by default", () => {
    expect(defaultExternalFilesSettings).toEqual({
      watchExternalChanges: true,
      autoReloadCleanFiles: true,
      checkOnWindowFocus: true,
      checkOnTabActivate: true,
      maxBinaryOpenAsTextBytes: 200 * 1024,
      maxOpenWithoutConfirmBytes: 1024 * 1024,
    });
  });
});

/**
 * M6-T3/T6 — keybind customization is implemented in prior milestones
 * (commands/commandBindings.ts + commandBindingRuntime.ts). This test pins the
 * settings.json persistence of user-customized keybinds so the round-trip
 * stays intact.
 */
describe("commandBindingOverrides persistence", () => {
  it("round-trips customized bindings through toPersistedSettings", () => {
    const overrides = {
      "file.save": { mac: "Cmd+Shift+S", windows: undefined },
      "tab.close": { mac: undefined, windows: "Ctrl+Shift+W" },
    };
    const persisted = toPersistedSettings({
      ...defaultPersistedSettings,
      externalFiles: toExternalFilesSettings(defaultPersistedSettings),
      commandBindingOverrides: overrides,
    });
    expect(persisted.commandBindingOverrides).toEqual({
      "file.save": { mac: "Cmd+Shift+S", windows: undefined },
      "tab.close": { mac: undefined, windows: "Ctrl+Shift+W" },
    });
  });

  it("loadPersistedSettings preserves customized bindings", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        ...defaultPersistedSettings,
        commandBindingOverrides: {
          "file.save": { mac: "Cmd+Shift+S", windows: "Ctrl+Shift+S" },
        },
      }),
    );
    const result = await loadPersistedSettings();
    expect(result?.commandBindingOverrides).toEqual({
      "file.save": { mac: "Cmd+Shift+S", windows: "Ctrl+Shift+S" },
    });
  });

  it("loadPersistedSettings drops malformed binding entries", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        ...defaultPersistedSettings,
        commandBindingOverrides: {
          "file.save": { mac: "Cmd+K" },
          "bad-no-binding": {},
          "bad-not-object": "Cmd+X",
        },
      }),
    );
    const result = await loadPersistedSettings();
    expect(result?.commandBindingOverrides).toEqual({
      "file.save": { mac: "Cmd+K", windows: undefined },
    });
  });
});

/**
 * M6-T2/T4/T5 — appearance settings (font sizes, sound, OS notifications)
 * survive the settings.json round-trip.
 */
/**
 * M13-T1 — chat-http master toggle is opt-in only (defaults to `false`) and
 * ignores legacy settings.json files that predate the field.
 */
describe("chatHttp master toggle persistence", () => {
  it("defaults chatHttp.enabled to false on a fresh install", async () => {
    readTextFileMock.mockResolvedValue(JSON.stringify(defaultPersistedSettings));
    const result = await loadPersistedSettings();
    expect(result?.chatHttp).toEqual({ enabled: false });
  });

  it("normalizes legacy settings.json without chatHttp to enabled=false", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        wrapLines: true,
        zoomPercent: 100,
      }),
    );
    const result = await loadPersistedSettings();
    expect(result?.chatHttp).toEqual({ enabled: false });
  });

  it("preserves chatHttp.enabled=true when persisted", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        ...defaultPersistedSettings,
        chatHttp: { enabled: true },
      }),
    );
    const result = await loadPersistedSettings();
    expect(result?.chatHttp).toEqual({ enabled: true });
  });

  it("falls back to enabled=false when persisted chatHttp has a non-boolean value", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        ...defaultPersistedSettings,
        chatHttp: { enabled: "yes" },
      }),
    );
    const result = await loadPersistedSettings();
    expect(result?.chatHttp).toEqual({ enabled: false });
  });

  it("toPersistedSettings round-trips chatHttp", () => {
    const persisted = toPersistedSettings({
      ...defaultPersistedSettings,
      externalFiles: toExternalFilesSettings(defaultPersistedSettings),
      chatHttp: { enabled: true },
    });
    expect(persisted.chatHttp).toEqual({ enabled: true });
  });
});

describe("appearance settings persistence", () => {
  it("round-trips font, sound, and OS notification settings", async () => {
    const custom = {
      fontSettings: { uiScale: 120, editorScale: 90, chatScale: 110 },
      soundSettings: {
        enabled: false,
        volume: 42,
        events: {
          sessionDone: true,
          permission: false,
          question: true,
          error: false,
        },
      },
      osNotificationSettings: {
        enabled: true,
        events: {
          sessionDone: false,
          permission: true,
          question: true,
          error: true,
        },
      },
    };
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ ...defaultPersistedSettings, ...custom }),
    );
    const result = await loadPersistedSettings();
    expect(result?.fontSettings).toEqual(custom.fontSettings);
    expect(result?.soundSettings).toEqual(custom.soundSettings);
    expect(result?.osNotificationSettings).toEqual(custom.osNotificationSettings);
  });

  it("falls back to defaults when appearance settings are absent", async () => {
    readTextFileMock.mockResolvedValue(JSON.stringify(defaultPersistedSettings));
    const result = await loadPersistedSettings();
    expect(result?.fontSettings).toEqual(defaultFontSettings);
    expect(result?.soundSettings).toEqual(defaultSoundSettings);
    expect(result?.osNotificationSettings).toEqual(defaultOsNotificationSettings);
  });
});

describe("restrictFilesToContext persistence", () => {
  it("defaults to false", () => {
    expect(defaultPersistedSettings.restrictFilesToContext).toBe(false);
  });

  it("preserves the setting through the round-trip", () => {
    const persisted = toPersistedSettings({
      ...defaultPersistedSettings,
      externalFiles: toExternalFilesSettings(defaultPersistedSettings),
      restrictFilesToContext: true,
    });
    expect(persisted.restrictFilesToContext).toBe(true);
  });

  it("falls back to false when the field is missing (legacy settings)", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        wrapLines: true,
        zoomPercent: 100,
      }),
    );
    const result = await loadPersistedSettings();
    expect(result?.restrictFilesToContext).toBe(false);
  });
});

describe("showMinimap persistence", () => {
  it("defaults to true", () => {
    expect(defaultPersistedSettings.showMinimap).toBe(true);
  });

  it("preserves the setting through the round-trip", () => {
    const persisted = toPersistedSettings({
      ...defaultPersistedSettings,
      externalFiles: toExternalFilesSettings(defaultPersistedSettings),
      showMinimap: false,
      showFoldGutter: true,
    });
    expect(persisted.showMinimap).toBe(false);
  });

  it("falls back to true when the field is missing (legacy settings)", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        wrapLines: true,
        zoomPercent: 100,
      }),
    );
    const result = await loadPersistedSettings();
    expect(result?.showMinimap).toBe(true);
  });

  it("normalizes a non-boolean persisted value back to true", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ ...defaultPersistedSettings, showMinimap: "yes" }),
    );
    const result = await loadPersistedSettings();
    expect(result?.showMinimap).toBe(true);
  });
});

describe("defaultMarkdownViewMode persistence", () => {
  it("defaults to preview", () => {
    expect(defaultPersistedSettings.defaultMarkdownViewMode).toBe("preview");
  });

  it("preserves a configured mode through the round-trip", () => {
    const persisted = toPersistedSettings({
      ...defaultPersistedSettings,
      externalFiles: toExternalFilesSettings(defaultPersistedSettings),
      defaultMarkdownViewMode: "edit",
    });
    expect(persisted.defaultMarkdownViewMode).toBe("edit");
  });

  it("falls back to preview when the persisted value is invalid", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ ...defaultPersistedSettings, defaultMarkdownViewMode: "weird" }),
    );
    const result = await loadPersistedSettings();
    expect(result?.defaultMarkdownViewMode).toBe("preview");
  });

  it("falls back to preview when the field is missing (legacy settings)", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        wrapLines: true,
        zoomPercent: 100,
      }),
    );
    const result = await loadPersistedSettings();
    expect(result?.defaultMarkdownViewMode).toBe("preview");
  });
});
