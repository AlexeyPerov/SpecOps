import { describe, expect, it } from "vitest";
import { defaultDebugProviderSettings } from "./debugProviderSettings";
import { defaultGlmProviderSettings } from "./glmProviderSettings";
import {
  formatProviderSwitchNotice,
  isGlmProviderConfigured,
  listSelectableChatProviders,
  resolveDefaultChatProvider,
} from "./selection";

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
});
