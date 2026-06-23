/** Theme persistence and migration are covered in `themeStore.test.ts`. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
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
        maxBinaryOpenAsTextBytes: 200 * 1024,
        maxOpenWithoutConfirmBytes: 512 * 1024,
      },
      decoratePlaintextSymbols: false,
      hideActivityRailWhenNotepadOnly: true,
      opencode: defaultOpencodeSettings,
      chatHttp: { enabled: false },
      logSettings: { ...defaultLogSettings, verboseProviderLogging: false },
      chatModes: defaultChatModesSettings,
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
          agentDone: true,
          permission: false,
          question: true,
          error: false,
        },
      },
      osNotificationSettings: {
        enabled: true,
        events: {
          agentDone: false,
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
