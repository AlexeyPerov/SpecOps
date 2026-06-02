import { describe, expect, it } from "vitest";
import {
  defaultAppProviderSettings,
  getProviderSettings,
  normalizeAppProviderSettings,
} from "./appProviderSettings";
import { defaultDebugProviderSettings } from "./debugProviderSettings";
import { defaultGlmProviderSettings } from "./glmProviderSettings";

describe("normalizeAppProviderSettings", () => {
  it("returns defaults when input is missing", () => {
    expect(normalizeAppProviderSettings()).toEqual(defaultAppProviderSettings);
  });

  it("normalizes partial glm and debug blocks", () => {
    expect(
      normalizeAppProviderSettings({
        glm: { enabled: false, baseUrl: "https://example.test", modelId: "glm-x" },
        debug: { enabled: false },
      }),
    ).toEqual({
      glm: {
        enabled: false,
        baseUrl: "https://example.test",
        modelId: "glm-x",
      },
      debug: { ...defaultDebugProviderSettings, enabled: false },
    });
  });
});

describe("getProviderSettings", () => {
  it("returns typed provider blocks", () => {
    expect(getProviderSettings(defaultAppProviderSettings, "glm")).toEqual(
      defaultGlmProviderSettings,
    );
    expect(getProviderSettings(defaultAppProviderSettings, "debug")).toEqual(
      defaultDebugProviderSettings,
    );
  });
});
