import { describe, expect, it } from "vitest";
import { defaultGlmProviderSettings } from "./glmProviderSettings";
import {
  getGlmProviderMissingConfigMessage,
  getGlmProviderSetupHint,
  isGlmProviderConfigured,
  isGlmProviderSendBlocked,
  normalizeGlmProviderSettings,
} from "./glmProviderSettings";

describe("normalizeGlmProviderSettings", () => {
  it("returns defaults for missing input", () => {
    expect(normalizeGlmProviderSettings()).toEqual(defaultGlmProviderSettings);
  });

  it("normalizes empty strings back to defaults", () => {
    expect(
      normalizeGlmProviderSettings({
        enabled: false,
        baseUrl: "   ",
        modelId: "",
      }),
    ).toEqual({
      enabled: false,
      baseUrl: defaultGlmProviderSettings.baseUrl,
      modelId: defaultGlmProviderSettings.modelId,
    });
  });

  it("trims base URL and model id", () => {
    expect(
      normalizeGlmProviderSettings({
        baseUrl: " https://example.test/v1 ",
        modelId: " custom-model ",
      }),
    ).toEqual({
      enabled: true,
      baseUrl: "https://example.test/v1",
      modelId: "custom-model",
    });
  });
});

describe("GLM provider readiness helpers", () => {
  it("requires enabled flag and non-empty API key", () => {
    expect(isGlmProviderConfigured(defaultGlmProviderSettings, "")).toBe(false);
    expect(isGlmProviderConfigured(defaultGlmProviderSettings, "  ")).toBe(false);
    expect(isGlmProviderConfigured(defaultGlmProviderSettings, "key-123")).toBe(true);
    expect(
      isGlmProviderConfigured({ ...defaultGlmProviderSettings, enabled: false }, "key-123"),
    ).toBe(false);
  });

  it("blocks send only for GLM when credentials are missing", () => {
    expect(isGlmProviderSendBlocked("glm", defaultGlmProviderSettings, "")).toBe(true);
    expect(isGlmProviderSendBlocked("glm", defaultGlmProviderSettings, "key-123")).toBe(false);
    expect(isGlmProviderSendBlocked("debug", defaultGlmProviderSettings, "")).toBe(false);
  });

  it("exposes setup copy for inline CTA", () => {
    expect(getGlmProviderMissingConfigMessage()).toContain("API key");
    expect(getGlmProviderSetupHint()).toContain("Settings");
    expect(getGlmProviderSetupHint()).toContain("GLM");
  });
});
