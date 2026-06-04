import { describe, expect, it } from "vitest";
import {
  defaultGlmProviderSettings,
  getGlmProviderMissingConfigMessage,
  getGlmProviderSetupHint,
  isGlmProviderConfigured,
  isGlmProviderSendBlocked,
  normalizeGlmProviderSettings,
  syncGlmProviderSettingsWithCatalog,
} from "./glmProviderSettings";
import { defaultProviderModelCatalogs } from "./providerModelCatalog";

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

  it("uses catalog default model when model id is empty", () => {
    const catalogs = {
      ...defaultProviderModelCatalogs,
      glm: {
        modelIds: ["glm-custom"],
        defaultModelId: "glm-custom",
      },
    };

    expect(normalizeGlmProviderSettings({ modelId: "" }, catalogs)).toEqual({
      ...defaultGlmProviderSettings,
      modelId: "glm-custom",
    });
  });
});

describe("syncGlmProviderSettingsWithCatalog", () => {
  it("aligns legacy model id with catalog default", () => {
    const catalogs = {
      ...defaultProviderModelCatalogs,
      glm: {
        modelIds: ["glm-custom"],
        defaultModelId: "glm-custom",
      },
    };

    expect(
      syncGlmProviderSettingsWithCatalog(
        { ...defaultGlmProviderSettings, modelId: "glm-4-flash" },
        catalogs,
      ).modelId,
    ).toBe("glm-custom");
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
    expect(getGlmProviderSetupHint()).toContain("Connections");
  });
});
