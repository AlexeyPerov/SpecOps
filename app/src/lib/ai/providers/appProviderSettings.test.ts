import { describe, expect, it } from "vitest";
import {
  defaultAppProviderSettings,
  getProviderSettings,
  normalizeAppProviderSettings,
} from "./appProviderSettings";
import { defaultDebugProviderSettings } from "./debugProviderSettings";
import { defaultHttpConnectionSettings } from "./httpConnectionSettings";

describe("normalizeAppProviderSettings", () => {
  it("returns defaults when input is missing", () => {
    expect(normalizeAppProviderSettings()).toEqual(defaultAppProviderSettings);
  });

  it("normalizes partial http and debug blocks", () => {
    expect(
      normalizeAppProviderSettings({
        http: { enabled: false, baseUrl: "https://example.test/v1" },
        debug: { enabled: false },
      }),
    ).toEqual({
      http: {
        enabled: false,
        baseUrl: "https://example.test/v1",
      },
      debug: { ...defaultDebugProviderSettings, enabled: false },
    });
  });
});

describe("getProviderSettings", () => {
  it("returns typed provider blocks", () => {
    expect(getProviderSettings(defaultAppProviderSettings, "http")).toEqual(
      defaultHttpConnectionSettings,
    );
    expect(getProviderSettings(defaultAppProviderSettings, "debug")).toEqual(
      defaultDebugProviderSettings,
    );
  });
});
