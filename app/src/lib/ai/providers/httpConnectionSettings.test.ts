import { describe, expect, it } from "vitest";
import { defaultAppProviderSettings } from "./appProviderSettings";
import {
  defaultHttpConnection,
  DEFAULT_HTTP_CONNECTION_ID,
  isHttpConnectionConfigured,
  listConfiguredHttpConnections,
  resolveHttpConnection,
} from "./httpConnectionSettings";

describe("httpConnectionSettings resolver helpers", () => {
  const settings = {
    ...defaultAppProviderSettings,
    httpConnections: [
      {
        id: "conn-a",
        label: "OpenRouter",
        enabled: true,
        baseUrl: "https://openrouter.ai/api/v1",
        modelCatalog: { modelIds: ["openai/gpt-4.1-mini"], defaultModelId: "openai/gpt-4.1-mini" },
      },
      {
        id: "conn-b",
        label: "Gateway",
        enabled: true,
        baseUrl: "https://gateway.example/v1",
        modelCatalog: { modelIds: ["gpt-4o-mini"], defaultModelId: "gpt-4o-mini" },
      },
      {
        id: "conn-disabled",
        label: "Disabled",
        enabled: false,
        baseUrl: "https://disabled.example/v1",
        modelCatalog: { modelIds: ["gpt-4o-mini"], defaultModelId: "gpt-4o-mini" },
      },
      {
        id: "conn-invalid-url",
        label: "Invalid URL",
        enabled: true,
        baseUrl: "not-a-url",
        modelCatalog: { modelIds: ["gpt-4o-mini"], defaultModelId: "gpt-4o-mini" },
      },
    ],
    defaultConnectionId: "conn-b",
  };

  it("resolves requested connection id when present", () => {
    const resolved = resolveHttpConnection(settings, { "conn-a": "key-a", "conn-b": "key-b" }, "conn-a");
    expect(resolved?.connection.id).toBe("conn-a");
    expect(resolved?.apiKey).toBe("key-a");
  });

  it("falls back to default then first connection when requested id is stale", () => {
    const resolved = resolveHttpConnection(settings, { "conn-b": "key-b" }, "missing");
    expect(resolved?.connection.id).toBe("conn-b");
    expect(resolved?.apiKey).toBe("key-b");

    const noDefault = {
      ...settings,
      defaultConnectionId: "missing-default",
      httpConnections: settings.httpConnections.slice(0, 2),
    };
    const fallback = resolveHttpConnection(noDefault, { "conn-a": "key-a" }, "missing");
    expect(fallback?.connection.id).toBe("conn-a");
    expect(fallback?.apiKey).toBe("key-a");
  });

  it("maps legacy apiKeys.http for default connection fallback", () => {
    const legacy = resolveHttpConnection(
      {
        ...defaultAppProviderSettings,
        httpConnections: [
          {
            ...defaultHttpConnection,
            id: DEFAULT_HTTP_CONNECTION_ID,
            enabled: true,
          },
        ],
        defaultConnectionId: DEFAULT_HTTP_CONNECTION_ID,
      },
      { http: "legacy-http-key" },
      DEFAULT_HTTP_CONNECTION_ID,
    );
    expect(legacy?.apiKey).toBe("legacy-http-key");
  });

  it("lists only enabled+valid+credentialed configured connections", () => {
    const configured = listConfiguredHttpConnections(settings, {
      "conn-a": "key-a",
      "conn-b": "   ",
      "conn-disabled": "key-disabled",
      "conn-invalid-url": "key-invalid",
    });
    expect(configured.map((connection) => connection.id)).toEqual(["conn-a"]);
  });

  it("detects invalid connection settings", () => {
    expect(
      isHttpConnectionConfigured(
        { enabled: true, baseUrl: "https://ok.example/v1" },
        "key-a",
      ),
    ).toBe(true);
    expect(isHttpConnectionConfigured({ enabled: false, baseUrl: "https://ok.example/v1" }, "key-a")).toBe(
      false,
    );
    expect(isHttpConnectionConfigured({ enabled: true, baseUrl: "bad-url" }, "key-a")).toBe(false);
    expect(isHttpConnectionConfigured({ enabled: true, baseUrl: "https://ok.example/v1" }, "   ")).toBe(
      false,
    );
  });
});
