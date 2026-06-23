import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppProviderSettings } from "../../domain/contracts";
import { defaultDebugProviderSettings } from "./debugProviderSettings";
import {
  defaultHttpConnectionSettings,
  defaultHttpConnection,
  DEFAULT_HTTP_CONNECTION_ID,
} from "./httpConnectionSettings";
import { isChatHttpRailVisible } from "./chatHttpRailGating";
import { defaultAppProviderSettings } from "./appProviderSettings";
import { defaultChatHttpSettings } from "../../services/chatHttpSettings";

describe("isChatHttpRailVisible", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const configuredSettings = {
    ...defaultHttpConnectionSettings,
    enabled: true,
    baseUrl: "http://localhost:11434/v1",
  };
  const configuredApiKey = "secret-key";
  const debugChatDisabled = { ...defaultDebugProviderSettings, enabled: false };
  const debugChatEnabled = { ...defaultDebugProviderSettings, enabled: true };
  const chatHttpDisabled = { enabled: false };
  const chatHttpEnabled = { enabled: true };

  function withHttpConnection(settings: typeof configuredSettings): AppProviderSettings {
    return {
      ...defaultAppProviderSettings,
      http: settings,
      httpConnections: [
        {
          ...defaultHttpConnection,
          ...settings,
          id: DEFAULT_HTTP_CONNECTION_ID,
        },
      ],
      defaultConnectionId: DEFAULT_HTTP_CONNECTION_ID,
    };
  }

  it("returns false when chatHttp master toggle is disabled even if HTTP is fully configured", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection(configuredSettings),
        { [DEFAULT_HTTP_CONNECTION_ID]: configuredApiKey },
        debugChatDisabled,
        chatHttpDisabled,
      ),
    ).toBe(false);
  });

  it("returns false when chatHttp master toggle is disabled even if Debug AI is enabled", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection({ ...configuredSettings, enabled: false }),
        {},
        debugChatEnabled,
        chatHttpDisabled,
      ),
    ).toBe(false);
  });

  it("returns true when chatHttp master toggle is enabled and HTTP gating conditions pass", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection(configuredSettings),
        { [DEFAULT_HTTP_CONNECTION_ID]: configuredApiKey },
        debugChatDisabled,
        chatHttpEnabled,
      ),
    ).toBe(true);
  });

  it("returns true when chatHttp master toggle is enabled and Debug AI is enabled without HTTP configuration", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection({ ...configuredSettings, enabled: false }),
        {},
        debugChatEnabled,
        chatHttpEnabled,
      ),
    ).toBe(true);
  });

  it("returns false when chatHttp master toggle is enabled but HTTP is not configured and Debug AI is disabled", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection({ ...configuredSettings, enabled: false }),
        {},
        debugChatDisabled,
        chatHttpEnabled,
      ),
    ).toBe(false);
  });

  it("returns false when chatHttp master toggle is enabled but the HTTP connection is disabled and Debug AI is disabled", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection({ ...configuredSettings, enabled: false }),
        { [DEFAULT_HTTP_CONNECTION_ID]: configuredApiKey },
        debugChatDisabled,
        chatHttpEnabled,
      ),
    ).toBe(false);
  });

  it("returns false when chatHttp master toggle is enabled but the API key is missing or whitespace", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection(configuredSettings),
        {},
        debugChatDisabled,
        chatHttpEnabled,
      ),
    ).toBe(false);
    expect(
      isChatHttpRailVisible(
        withHttpConnection(configuredSettings),
        { [DEFAULT_HTTP_CONNECTION_ID]: "   " },
        debugChatDisabled,
        chatHttpEnabled,
      ),
    ).toBe(false);
  });

  it("returns false when chatHttp master toggle is enabled but baseUrl is empty or whitespace", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection({ ...configuredSettings, baseUrl: "" }),
        { [DEFAULT_HTTP_CONNECTION_ID]: configuredApiKey },
        debugChatDisabled,
        chatHttpEnabled,
      ),
    ).toBe(false);
    expect(
      isChatHttpRailVisible(
        withHttpConnection({ ...configuredSettings, baseUrl: "   " }),
        { [DEFAULT_HTTP_CONNECTION_ID]: configuredApiKey },
        debugChatDisabled,
        chatHttpEnabled,
      ),
    ).toBe(false);
  });

  it("returns false when chatHttp master toggle is enabled but the configured connection default model is missing", () => {
    const settings = withHttpConnection(configuredSettings);
    const baseConnection = settings.httpConnections?.[0] ?? defaultHttpConnection;
    settings.httpConnections = [
      {
        ...baseConnection,
        modelCatalog: { modelIds: ["gpt-4o-mini"], defaultModelId: "" },
      },
    ];

    expect(
      isChatHttpRailVisible(
        settings,
        { [DEFAULT_HTTP_CONNECTION_ID]: configuredApiKey },
        debugChatDisabled,
        chatHttpEnabled,
      ),
    ).toBe(false);
  });

  it("returns true when chatHttp master toggle is enabled and any configured connection has a resolvable default model", () => {
    const settings = withHttpConnection(configuredSettings);
    const baseConnection = settings.httpConnections?.[0] ?? defaultHttpConnection;
    settings.httpConnections = [
      {
        ...baseConnection,
        id: "broken",
        modelCatalog: { modelIds: ["gpt-4o-mini"], defaultModelId: "" },
      },
      {
        ...baseConnection,
        id: "healthy",
        label: "Healthy",
        modelCatalog: { modelIds: ["gpt-4.1-mini"], defaultModelId: "gpt-4.1-mini" },
      },
    ];

    expect(
      isChatHttpRailVisible(
        settings,
        { broken: configuredApiKey, healthy: configuredApiKey },
        debugChatDisabled,
        chatHttpEnabled,
      ),
    ).toBe(true);
  });

  it("treats missing chatHttpSettings as the default (enabled=false)", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection(configuredSettings),
        { [DEFAULT_HTTP_CONNECTION_ID]: configuredApiKey },
        debugChatDisabled,
      ),
    ).toBe(false);
  });

  it("uses defaultChatHttpSettings (enabled=false) as the documented default", () => {
    expect(defaultChatHttpSettings).toEqual({ enabled: false });
  });
});
