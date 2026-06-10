import { describe, expect, it } from "vitest";
import { defaultAppProviderSettings } from "./appProviderSettings";
import { defaultDebugProviderSettings } from "./debugProviderSettings";
import {
  defaultHttpConnection,
  defaultHttpConnectionSettings,
  DEFAULT_HTTP_CONNECTION_ID,
} from "./httpConnectionSettings";
import {
  listSelectableChatConnections,
  canSelectChatProvider,
  formatModelSwitchNotice,
  formatProviderSwitchNotice,
  isHttpProviderConfigured,
  parseChatConnectionSelection,
  resolveActiveChatConnectionSelection,
  listSelectableChatProviders,
  listSelectableModelsForConnection,
  listSelectableModelsForProvider,
  resolveDefaultChatProvider,
  resolveProviderSwitchModelId,
  resolveWorkspaceModelId,
  listSelectableWorkspaceModels,
} from "./selection";
import { defaultProviderModelCatalogs } from "./providerModelCatalog";

function providerSettingsWithDebugEnabled(enabled: boolean) {
  return {
    ...defaultAppProviderSettings,
    httpConnections: [{ ...defaultHttpConnection, enabled: true }],
    defaultConnectionId: DEFAULT_HTTP_CONNECTION_ID,
    debugChat: { ...defaultDebugProviderSettings, enabled },
    debugWorkspace: { ...defaultDebugProviderSettings, enabled },
  };
}

describe("chat provider selection", () => {
  it("lists scoped debug providers when enabled and omits HTTP until configured", () => {
    expect(listSelectableChatProviders(providerSettingsWithDebugEnabled(false))).toEqual([]);

    expect(listSelectableChatProviders(providerSettingsWithDebugEnabled(true))).toEqual([
      { id: "debug-workspace", label: "Debug Provider" },
    ]);

    expect(
      listSelectableChatProviders(providerSettingsWithDebugEnabled(true), {
        chatContextKind: "workspace",
        httpConfigured: true,
      }),
    ).toEqual([
      { id: "http", label: "HTTP" },
      { id: "debug-workspace", label: "Debug Provider" },
    ]);
  });

  it("filters chat-http providers by HTTP configuration", () => {
    const enabled = providerSettingsWithDebugEnabled(true);
    expect(
      listSelectableChatProviders(enabled, {
        chatContextKind: "chat-http",
        httpConfigured: false,
      }),
    ).toEqual([{ id: "debug-chat", label: "Debug Provider" }]);

    expect(
      listSelectableChatProviders(enabled, {
        chatContextKind: "chat-http",
        httpConfigured: true,
      }),
    ).toEqual([
      { id: "http", label: "HTTP" },
      { id: "debug-chat", label: "Debug Provider" },
    ]);
  });

  it("requires HTTP configuration before listing HTTP in workspace chat", () => {
    const enabled = providerSettingsWithDebugEnabled(true);
    expect(
      canSelectChatProvider("http", enabled, {
        chatContextKind: "workspace",
        httpConfigured: false,
      }),
    ).toBe(false);
    expect(
      canSelectChatProvider("http", enabled, {
        chatContextKind: "workspace",
        httpConfigured: true,
      }),
    ).toBe(true);
  });

  it("validates provider selectability for chat-http", () => {
    const enabled = providerSettingsWithDebugEnabled(true);
    expect(
      canSelectChatProvider("http", enabled, {
        chatContextKind: "chat-http",
        httpConfigured: false,
      }),
    ).toBe(false);
    expect(
      canSelectChatProvider("http", enabled, {
        chatContextKind: "chat-http",
        httpConfigured: true,
      }),
    ).toBe(true);
    expect(
      canSelectChatProvider("debug-chat", providerSettingsWithDebugEnabled(false), {
        chatContextKind: "chat-http",
        httpConfigured: true,
      }),
    ).toBe(false);
    expect(
      canSelectChatProvider("debug-workspace", enabled, {
        chatContextKind: "chat-http",
        httpConfigured: true,
      }),
    ).toBe(false);
  });

  it("prefers HTTP for new threads when configured, otherwise scoped debug when enabled", () => {
    const enabled = providerSettingsWithDebugEnabled(true);
    expect(
      resolveDefaultChatProvider(
        enabled,
        { chatContextKind: "workspace" },
        isHttpProviderConfigured(enabled, { [DEFAULT_HTTP_CONNECTION_ID]: "key-123" }),
      ),
    ).toBe("http");
    expect(
      resolveDefaultChatProvider(enabled, { chatContextKind: "workspace" }, false),
    ).toBe("debug-workspace");
    expect(
      resolveDefaultChatProvider(
        providerSettingsWithDebugEnabled(false),
        { chatContextKind: "workspace" },
        isHttpProviderConfigured(providerSettingsWithDebugEnabled(false), {}),
      ),
    ).toBe("http");
    expect(
      resolveDefaultChatProvider(enabled, { chatContextKind: "chat-http" }, false),
    ).toBe("debug-chat");
  });

  it("does not treat an HTTP adapter as configured without credentials", () => {
    expect(
      isHttpProviderConfigured(
        {
          ...providerSettingsWithDebugEnabled(false),
          httpConnections: [{ ...defaultHttpConnection, ...defaultHttpConnectionSettings }],
        },
        {},
      ),
    ).toBe(false);
  });

  it("formats provider switch notices for history rendering", () => {
    expect(
      formatProviderSwitchNotice({
        type: "provider-switched",
        fromProvider: "http",
        toProvider: "debug-workspace",
      }),
    ).toBe("Provider switched from HTTP to Debug Provider.");

    expect(
      formatProviderSwitchNotice({
        type: "provider-switched",
        fromProvider: null,
        toProvider: "http",
      }),
    ).toBe("Provider switched to HTTP.");
  });

  it("lists selectable models for a provider from settings catalogs", () => {
    expect(listSelectableModelsForProvider(defaultProviderModelCatalogs, "http")).toEqual([
      "gpt-4o-mini",
    ]);
  });

  it("lists connection options with labels and scoped debug entry", () => {
    const settings = {
      ...providerSettingsWithDebugEnabled(true),
      httpConnections: [
        {
          ...defaultHttpConnection,
          id: "conn-a",
          label: "OpenRouter",
          enabled: true,
          modelCatalog: { modelIds: ["openai/gpt-4.1-mini"], defaultModelId: "openai/gpt-4.1-mini" },
        },
        {
          ...defaultHttpConnection,
          id: "conn-b",
          label: "Gateway",
          enabled: true,
          modelCatalog: { modelIds: ["gpt-4o-mini"], defaultModelId: "gpt-4o-mini" },
        },
      ],
      defaultConnectionId: "conn-a",
    };
    const apiKeys = { "conn-a": "key-a", "conn-b": "key-b" };

    expect(listSelectableChatConnections(settings, apiKeys, "workspace")).toEqual([
      { value: "http:conn-a", label: "OpenRouter", providerId: "http", connectionId: "conn-a" },
      { value: "http:conn-b", label: "Gateway", providerId: "http", connectionId: "conn-b" },
      { value: "debug-workspace", label: "Debug Provider", providerId: "debug-workspace" },
    ]);
  });

  it("resolves active connection selection with fallback for stale ids", () => {
    const settings = {
      ...providerSettingsWithDebugEnabled(true),
      httpConnections: [
        {
          ...defaultHttpConnection,
          id: "conn-a",
          label: "OpenRouter",
          enabled: true,
          modelCatalog: { modelIds: ["openai/gpt-4.1-mini"], defaultModelId: "openai/gpt-4.1-mini" },
        },
      ],
      defaultConnectionId: "conn-a",
    };
    const apiKeys = { "conn-a": "key-a" };

    expect(
      resolveActiveChatConnectionSelection("http", "missing", settings, apiKeys, "workspace"),
    ).toBe("http:conn-a");
    expect(
      resolveActiveChatConnectionSelection(
        "debug-workspace",
        undefined,
        settings,
        apiKeys,
        "workspace",
      ),
    ).toBe("debug-workspace");
  });

  it("parses connection selection values", () => {
    expect(parseChatConnectionSelection("http:conn-a")).toEqual({
      providerId: "http",
      connectionId: "conn-a",
    });
    expect(parseChatConnectionSelection("debug-chat")).toEqual({ providerId: "debug-chat" });
    expect(parseChatConnectionSelection("bad")).toBeNull();
  });

  it("lists models for the selected HTTP connection catalog", () => {
    const settings = {
      ...providerSettingsWithDebugEnabled(false),
      httpConnections: [
        {
          ...defaultHttpConnection,
          id: "conn-a",
          label: "OpenRouter",
          enabled: true,
          modelCatalog: { modelIds: ["openai/gpt-4.1-mini"], defaultModelId: "openai/gpt-4.1-mini" },
        },
      ],
      defaultConnectionId: "conn-a",
    };
    expect(
      listSelectableModelsForConnection(defaultProviderModelCatalogs, settings, "http", "conn-a"),
    ).toEqual(["openai/gpt-4.1-mini"]);
  });

  it("formats model switch notices for history rendering", () => {
    expect(
      formatModelSwitchNotice({
        type: "model-switched",
        fromModel: "gpt-4o-mini",
        toModel: "gpt-4.1-mini",
      }),
    ).toBe("Model switched from gpt-4o-mini to gpt-4.1-mini.");

    expect(
      formatModelSwitchNotice({
        type: "model-switched",
        fromModel: null,
        toModel: "gpt-4o-mini",
      }),
    ).toBe("Model switched to gpt-4o-mini.");
  });

  it("resolves provider-switch model fallback policy", () => {
    expect(
      resolveProviderSwitchModelId(defaultProviderModelCatalogs, "debug-workspace", "gpt-4o-mini"),
    ).toBe("debug-simulator");

    expect(
      resolveProviderSwitchModelId(defaultProviderModelCatalogs, "http", "gpt-4o-mini"),
    ).toBe("gpt-4o-mini");
  });

  it("uses HTTP connection catalog defaults when switching providers", () => {
    const settings = {
      ...providerSettingsWithDebugEnabled(false),
      httpConnections: [
        {
          ...defaultHttpConnection,
          id: "conn-glm",
          label: "GLM",
          enabled: true,
          modelCatalog: {
            modelIds: ["GLM-4.7"],
            defaultModelId: "GLM-4.7",
          },
        },
      ],
    };

    expect(
      resolveProviderSwitchModelId(
        defaultProviderModelCatalogs,
        "http",
        "debug-simulator",
        { providerSettings: settings, connectionId: "conn-glm" },
      ),
    ).toBe("GLM-4.7");
  });

  describe("resolveWorkspaceModelId", () => {
    it("returns preferred model when it exists in the catalog", () => {
      const models = [
        { id: "gpt-4.1", name: "GPT 4.1" },
        { id: "gpt-4.1-mini", name: "GPT 4.1 Mini" },
      ];
      expect(resolveWorkspaceModelId(models, "gpt-4.1")).toBe("gpt-4.1");
    });

    it("falls back to first model when preferred model is stale", () => {
      const models = [
        { id: "gpt-4.1", name: "GPT 4.1" },
        { id: "gpt-4.1-mini", name: "GPT 4.1 Mini" },
      ];
      expect(resolveWorkspaceModelId(models, "gpt-4o-mini")).toBe("gpt-4.1");
    });

    it("falls back to first model when preferred is null", () => {
      const models = [
        { id: "gpt-4.1", name: "GPT 4.1" },
      ];
      expect(resolveWorkspaceModelId(models, null)).toBe("gpt-4.1");
    });

    it("returns null for empty catalog", () => {
      expect(resolveWorkspaceModelId([], "gpt-4.1")).toBeNull();
      expect(resolveWorkspaceModelId([], null)).toBeNull();
    });

    it("trims whitespace from preferred model id", () => {
      const models = [
        { id: "gpt-4.1", name: "GPT 4.1" },
      ];
      expect(resolveWorkspaceModelId(models, "  gpt-4.1  ")).toBe("gpt-4.1");
    });
  });

  describe("listSelectableWorkspaceModels", () => {
    it("lists model ids from OpenCode catalog entries", () => {
      const models = [
        { id: "gpt-4.1", name: "GPT 4.1" },
        { id: "gpt-4.1-mini", name: "GPT 4.1 Mini" },
      ];
      expect(listSelectableWorkspaceModels(models)).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
    });

    it("returns empty array for empty catalog", () => {
      expect(listSelectableWorkspaceModels([])).toEqual([]);
    });
  });
});
