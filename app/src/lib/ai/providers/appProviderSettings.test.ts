import { describe, expect, it } from "vitest";
import {
  defaultAppProviderSettings,
  getProviderSettings,
  normalizeAppProviderSettings,
} from "./appProviderSettings";
import { defaultDebugProviderSettings } from "./debugProviderSettings";
import {
  defaultHttpConnectionSettings,
  DEFAULT_HTTP_CONNECTION_ID,
} from "./httpConnectionSettings";

describe("normalizeAppProviderSettings", () => {
  it("returns defaults when input is missing", () => {
    expect(normalizeAppProviderSettings()).toEqual(defaultAppProviderSettings);
  });

  it("normalizes partial http and legacy debug blocks into scoped settings", () => {
    expect(
      normalizeAppProviderSettings({
        http: { enabled: false, baseUrl: "https://example.test/v1" },
        debug: { enabled: false },
      }),
    ).toEqual({
      httpConnections: [
        {
          id: DEFAULT_HTTP_CONNECTION_ID,
          label: "HTTP",
          enabled: false,
          baseUrl: "https://example.test/v1",
          modelCatalog: {
            modelIds: ["gpt-4o-mini"],
            defaultModelId: "gpt-4o-mini",
          },
        },
      ],
      defaultConnectionId: DEFAULT_HTTP_CONNECTION_ID,
      http: {
        enabled: false,
        baseUrl: "https://example.test/v1",
      },
      debugChat: { ...defaultDebugProviderSettings, enabled: false },
      debugWorkspace: { ...defaultDebugProviderSettings, enabled: false },
    });
  });

  it("normalizes legacy singleton http settings into one default connection", () => {
    const normalized = normalizeAppProviderSettings({
      http: { enabled: true, baseUrl: "https://legacy.test/v1" },
    });
    expect(normalized.httpConnections?.[0]).toMatchObject({
      id: DEFAULT_HTTP_CONNECTION_ID,
      label: "HTTP",
      enabled: true,
      baseUrl: "https://legacy.test/v1",
    });
    expect(normalized.defaultConnectionId).toBe(DEFAULT_HTTP_CONNECTION_ID);
  });
});

describe("getProviderSettings", () => {
  it("returns typed provider blocks", () => {
    expect(getProviderSettings(defaultAppProviderSettings, "http")).toEqual(
      defaultHttpConnectionSettings,
    );
    expect(getProviderSettings(defaultAppProviderSettings, "debugWorkspace")).toEqual(
      defaultDebugProviderSettings,
    );
    expect(getProviderSettings(defaultAppProviderSettings, "debugChat")).toEqual(
      defaultDebugProviderSettings,
    );
  });
});
