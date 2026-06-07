import { beforeEach, describe, expect, it } from "vitest";
import { appState } from "../appState";
import { defaultSettings } from "./settingsSlice";
import {
  defaultHttpConnection,
  DEFAULT_HTTP_CONNECTION_ID,
  defaultHttpConnectionSettings,
} from "../../ai/providers/httpConnectionSettings";
import {
  defaultChatModesSettings,
  PRESET_CUSTOM_MODE_IDS,
} from "../../ai/modes/chatModesSettings";
import {
  defaultDebugProviderSettings,
  normalizeDebugProviderSettings,
} from "../../ai/providers/debugProviderSettings";
import {
  defaultProviderModelCatalogs,
  getProviderDefaultModelId,
} from "../../ai/providers/providerModelCatalog";

function providerSettings() {
  return appState.getSnapshot().settings.providerSettings;
}

function chatModes() {
  return appState.getSnapshot().settings.chatModes;
}

describe("appState settingsSlice CRUD", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  describe("HTTP connections", () => {
    it("addHttpConnection appends a normalized connection and preserves default when set", () => {
      appState.addHttpConnection({
        id: "remote",
        label: "  Remote  ",
        enabled: true,
        baseUrl: "https://api.example.com/v1",
      });

      const settings = providerSettings();
      expect(settings.httpConnections).toHaveLength(2);
      expect(settings.httpConnections[1]).toMatchObject({
        id: "remote",
        label: "Remote",
        enabled: true,
        baseUrl: "https://api.example.com/v1",
      });
      expect(settings.defaultConnectionId).toBe(DEFAULT_HTTP_CONNECTION_ID);
    });

    it("addHttpConnection replaces an existing connection with the same id", () => {
      appState.addHttpConnection({ id: "remote", label: "First", baseUrl: "http://first/v1" });
      appState.addHttpConnection({ id: "remote", label: "Second", baseUrl: "http://second/v1" });

      const connections = providerSettings().httpConnections;
      expect(connections.filter((entry) => entry.id === "remote")).toHaveLength(1);
      expect(connections.find((entry) => entry.id === "remote")).toMatchObject({
        label: "Second",
        baseUrl: "http://second/v1",
      });
    });

    it("updateHttpConnection patches a connection by id and ignores empty ids", () => {
      appState.addHttpConnection({ id: "remote", label: "Remote", baseUrl: "http://remote/v1" });
      appState.updateHttpConnection("remote", { label: "  Updated  ", enabled: true });
      appState.updateHttpConnection("   ", { label: "Ignored" });

      expect(providerSettings().httpConnections.find((entry) => entry.id === "remote")).toMatchObject({
        label: "Updated",
        enabled: true,
      });
    });

    it("removeHttpConnection falls back defaultConnectionId to the first remaining connection", () => {
      appState.addHttpConnection({ id: "alpha", label: "Alpha", baseUrl: "http://alpha/v1" });
      appState.addHttpConnection({ id: "beta", label: "Beta", baseUrl: "http://beta/v1" });
      appState.setDefaultConnectionId("beta");
      appState.setConnectionApiKey("beta", "secret");
      appState.setConnectionApiKey("alpha", "other");

      appState.removeHttpConnection("beta");

      const settings = providerSettings();
      expect(settings.httpConnections.map((entry) => entry.id)).toEqual(["default", "alpha"]);
      expect(settings.defaultConnectionId).toBe(DEFAULT_HTTP_CONNECTION_ID);
      expect(appState.getSnapshot().settings.providerApiKeys).not.toHaveProperty("beta");
      expect(appState.getSnapshot().settings.providerApiKeys.alpha).toBe("other");
    });

    it("removeHttpConnection clears connections and resets legacy http mirror when the last one is removed", () => {
      appState.removeHttpConnection(DEFAULT_HTTP_CONNECTION_ID);

      const settings = providerSettings();
      expect(settings.httpConnections).toEqual([]);
      expect(settings.defaultConnectionId).toBeUndefined();
      expect(settings.http).toEqual(defaultHttpConnectionSettings);
    });

    it("setDefaultConnectionId selects an existing connection and ignores unknown ids", () => {
      appState.addHttpConnection({ id: "remote", label: "Remote", baseUrl: "http://remote/v1" });
      appState.setDefaultConnectionId("remote");
      expect(providerSettings().defaultConnectionId).toBe("remote");

      appState.setDefaultConnectionId("missing");
      expect(providerSettings().defaultConnectionId).toBe(DEFAULT_HTTP_CONNECTION_ID);
    });
  });

  describe("chat modes", () => {
    it("setRawEnabled toggles raw mode availability", () => {
      expect(chatModes().rawEnabled).toBe(false);
      appState.setRawEnabled(true);
      expect(chatModes().rawEnabled).toBe(true);
    });

    it("updateBuiltinModeToggles patches context toggles for a built-in mode", () => {
      appState.updateBuiltinModeToggles("ask", { includeWorkspace: false, includeSummary: false });
      expect(chatModes().builtinToggles.ask).toEqual({
        includeWorkspace: false,
        includeSummary: false,
      });
      expect(chatModes().builtinToggles.review).toEqual(defaultChatModesSettings.builtinToggles.review);
    });

    it("addCustomChatMode appends a normalized custom mode", () => {
      appState.addCustomChatMode({
        id: "custom-test-mode",
        name: "  Test mode  ",
        prompt: "Do the thing.",
        enabled: false,
        requiredSections: ["  Summary  ", ""],
      });

      const mode = chatModes().customModes.find((entry) => entry.id === "custom-test-mode");
      expect(mode).toMatchObject({
        name: "Test mode",
        prompt: "Do the thing.",
        enabled: false,
        requiredSections: ["Summary"],
      });
    });

    it("updateCustomChatMode updates an existing mode and ignores unknown ids", () => {
      const presetId = PRESET_CUSTOM_MODE_IDS.ideation;
      appState.updateCustomChatMode(presetId, { name: "Renamed ideation", enabled: false });
      appState.updateCustomChatMode("custom-missing", { name: "Missing" });

      const mode = chatModes().customModes.find((entry) => entry.id === presetId);
      expect(mode?.name).toBe("Renamed ideation");
      expect(mode?.enabled).toBe(false);
      expect(chatModes().customModes).toHaveLength(defaultChatModesSettings.customModes.length);
    });

    it("removeCustomChatMode drops a mode without breaking default presets after reset", () => {
      const presetId = PRESET_CUSTOM_MODE_IDS.ideation;
      appState.removeCustomChatMode(presetId);
      expect(chatModes().customModes.some((entry) => entry.id === presetId)).toBe(false);

      appState.resetAppState();
      expect(appState.getSnapshot().settings.chatModes).toEqual(defaultSettings.chatModes);
    });
  });

  describe("debug provider settings", () => {
    it("setDebugChatProviderSettings replaces debug chat settings with normalized values", () => {
      appState.setDebugChatProviderSettings({
        ...defaultDebugProviderSettings,
        enabled: false,
        delayMsMin: 50,
        delayMsMax: 10,
        failureProbability: 2,
        failureMessage: "   ",
      });

      expect(providerSettings().debugChat).toEqual(
        normalizeDebugProviderSettings({
          enabled: false,
          delayMsMin: 50,
          delayMsMax: 10,
          failureProbability: 2,
          failureMessage: "   ",
        }),
      );
    });

    it("updateDebugChatProviderSettings patches debug chat settings", () => {
      appState.updateDebugChatProviderSettings({ enabled: false, includeDiagnostics: false });
      expect(providerSettings().debugChat.enabled).toBe(false);
      expect(providerSettings().debugChat.includeDiagnostics).toBe(false);
      expect(providerSettings().debugChat.delayMsMin).toBe(defaultDebugProviderSettings.delayMsMin);
    });

    it("setDebugWorkspaceProviderSettings replaces debug workspace settings", () => {
      appState.setDebugWorkspaceProviderSettings({
        ...defaultDebugProviderSettings,
        enabled: false,
        chunkCharsMin: 4,
        chunkCharsMax: 2,
      });

      expect(providerSettings().debugWorkspace).toEqual(
        normalizeDebugProviderSettings({
          enabled: false,
          chunkCharsMin: 4,
          chunkCharsMax: 2,
        }),
      );
    });

    it("updateDebugWorkspaceProviderSettings patches debug workspace settings", () => {
      appState.updateDebugWorkspaceProviderSettings({ simulationSeed: 42 });
      expect(providerSettings().debugWorkspace.simulationSeed).toBe(42);
    });
  });

  describe("provider catalogs and API keys", () => {
    it("updateProviderModelCatalog patches a provider catalog", () => {
      appState.updateProviderModelCatalog("http", {
        modelIds: ["alpha", "beta", "alpha"],
        defaultModelId: "beta",
      });

      const catalog = appState.getSnapshot().settings.providerModelCatalogs.http;
      expect(catalog?.modelIds).toEqual(["alpha", "beta"]);
      expect(catalog?.defaultModelId).toBe("beta");
    });

    it("setProviderApiKey stores and clears connection-scoped API keys", () => {
      appState.setProviderApiKey("default", "  secret-key  ");
      expect(appState.getSnapshot().settings.providerApiKeys.default).toBe("secret-key");

      appState.setProviderApiKey("default", "   ");
      expect(appState.getSnapshot().settings.providerApiKeys).not.toHaveProperty("default");
    });

    it("setConnectionApiKey updates keys for non-default connections", () => {
      appState.addHttpConnection({ id: "remote", label: "Remote", baseUrl: "http://remote/v1" });
      appState.setConnectionApiKey("remote", "remote-key");
      expect(appState.getSnapshot().settings.providerApiKeys.remote).toBe("remote-key");
    });
  });

  it("starts from normalized default settings", () => {
    const snapshot = appState.getSnapshot().settings;
    expect(snapshot.providerSettings.httpConnections).toEqual([defaultHttpConnection]);
    expect(snapshot.providerSettings.defaultConnectionId).toBe(DEFAULT_HTTP_CONNECTION_ID);
    expect(snapshot.chatModes).toEqual(defaultSettings.chatModes);
    expect(getProviderDefaultModelId(snapshot.providerModelCatalogs, "http")).toBe(
      defaultProviderModelCatalogs.http!.defaultModelId,
    );
  });
});
