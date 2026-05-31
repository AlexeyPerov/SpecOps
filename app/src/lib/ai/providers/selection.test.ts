import { describe, expect, it } from "vitest";
import { defaultDebugProviderSettings } from "./debugProviderSettings";
import { defaultGlmProviderSettings } from "./glmProviderSettings";
import {
  formatModelSwitchNotice,
  formatProviderSwitchNotice,
  isGlmProviderConfigured,
  listSelectableChatProviders,
  listSelectableModelsForProvider,
  resolveDefaultChatProvider,
  resolveProviderSwitchModelId,
} from "./selection";
import { defaultProviderModelCatalogs } from "./providerModelCatalog";

describe("chat provider selection", () => {
  it("lists product providers and Debug only when enabled", () => {
    expect(listSelectableChatProviders({ ...defaultDebugProviderSettings, enabled: false })).toEqual([
      { id: "glm", label: "GLM" },
    ]);

    expect(listSelectableChatProviders({ ...defaultDebugProviderSettings, enabled: true })).toEqual([
      { id: "glm", label: "GLM" },
      { id: "debug", label: "Debug" },
    ]);
  });

  it("prefers GLM for new threads when configured, otherwise Debug when enabled", () => {
    expect(
      resolveDefaultChatProvider(
        defaultDebugProviderSettings,
        isGlmProviderConfigured(defaultGlmProviderSettings, "key-123"),
      ),
    ).toBe("glm");
    expect(resolveDefaultChatProvider({ ...defaultDebugProviderSettings, enabled: true }, false)).toBe(
      "debug",
    );
    expect(
      resolveDefaultChatProvider(
        { ...defaultDebugProviderSettings, enabled: false },
        isGlmProviderConfigured(defaultGlmProviderSettings, ""),
      ),
    ).toBe("glm");
  });

  it("does not treat a registered GLM adapter as configured without credentials", () => {
    expect(
      isGlmProviderConfigured(defaultGlmProviderSettings, ""),
    ).toBe(false);
  });

  it("formats provider switch notices for history rendering", () => {
    expect(
      formatProviderSwitchNotice({
        type: "provider-switched",
        fromProvider: "glm",
        toProvider: "debug",
      }),
    ).toBe("Provider switched from GLM to Debug.");

    expect(
      formatProviderSwitchNotice({
        type: "provider-switched",
        fromProvider: null,
        toProvider: "glm",
      }),
    ).toBe("Provider switched to GLM.");
  });

  it("lists selectable models for a provider from settings catalogs", () => {
    expect(listSelectableModelsForProvider(defaultProviderModelCatalogs, "glm")).toEqual([
      "glm-4-flash",
      "glm-4-air",
      "glm-4-plus",
    ]);
  });

  it("formats model switch notices for history rendering", () => {
    expect(
      formatModelSwitchNotice({
        type: "model-switched",
        fromModel: "glm-4-flash",
        toModel: "glm-4-plus",
      }),
    ).toBe("Model switched from glm-4-flash to glm-4-plus.");

    expect(
      formatModelSwitchNotice({
        type: "model-switched",
        fromModel: null,
        toModel: "glm-4-flash",
      }),
    ).toBe("Model switched to glm-4-flash.");
  });

  it("resolves provider-switch model fallback policy", () => {
    expect(
      resolveProviderSwitchModelId(defaultProviderModelCatalogs, "debug", "glm-4-plus"),
    ).toBe("debug-simulator");

    expect(
      resolveProviderSwitchModelId(defaultProviderModelCatalogs, "glm", "glm-4-plus"),
    ).toBe("glm-4-plus");
  });
});
