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

  it("returns true when all HTTP gating conditions pass", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection(configuredSettings),
        { [DEFAULT_HTTP_CONNECTION_ID]: configuredApiKey },
        debugChatDisabled,
      ),
    ).toBe(true);
  });

  it("returns true when Debug AI is enabled without HTTP configuration", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection({ ...configuredSettings, enabled: false }),
        {},
        debugChatEnabled,
      ),
    ).toBe(true);
  });

  it("returns false when HTTP is not configured and Debug AI is disabled", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection({ ...configuredSettings, enabled: false }),
        {},
        debugChatDisabled,
      ),
    ).toBe(false);
  });

  it("returns false when the HTTP connection is disabled and Debug AI is disabled", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection({ ...configuredSettings, enabled: false }),
        { [DEFAULT_HTTP_CONNECTION_ID]: configuredApiKey },
        debugChatDisabled,
      ),
    ).toBe(false);
  });

  it("returns false when the API key is missing or whitespace", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection(configuredSettings),
        {},
        debugChatDisabled,
      ),
    ).toBe(false);
    expect(
      isChatHttpRailVisible(
        withHttpConnection(configuredSettings),
        { [DEFAULT_HTTP_CONNECTION_ID]: "   " },
        debugChatDisabled,
      ),
    ).toBe(false);
  });

  it("returns false when baseUrl is empty or whitespace", () => {
    expect(
      isChatHttpRailVisible(
        withHttpConnection({ ...configuredSettings, baseUrl: "" }),
        { [DEFAULT_HTTP_CONNECTION_ID]: configuredApiKey },
        debugChatDisabled,
      ),
    ).toBe(false);
    expect(
      isChatHttpRailVisible(
        withHttpConnection({ ...configuredSettings, baseUrl: "   " }),
        { [DEFAULT_HTTP_CONNECTION_ID]: configuredApiKey },
        debugChatDisabled,
      ),
    ).toBe(false);
  });

  it("returns false when the configured connection default model is missing", () => {
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
      ),
    ).toBe(false);
  });

  it("returns true when any configured connection has a resolvable default model", () => {
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
      ),
    ).toBe(true);
  });
});
