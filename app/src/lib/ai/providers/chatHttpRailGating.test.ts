import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderModelCatalogs } from "../../domain/contracts";
import { defaultDebugProviderSettings } from "./debugProviderSettings";
import { defaultHttpConnectionSettings } from "./httpConnectionSettings";
import { isChatHttpRailVisible } from "./chatHttpRailGating";
import * as providerModelCatalog from "./providerModelCatalog";
import { defaultProviderModelCatalogs } from "./providerModelCatalog";

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

  it("returns true when all HTTP gating conditions pass", () => {
    expect(
      isChatHttpRailVisible(
        configuredSettings,
        configuredApiKey,
        defaultProviderModelCatalogs,
        debugChatDisabled,
      ),
    ).toBe(true);
  });

  it("returns true when Debug AI is enabled without HTTP configuration", () => {
    expect(
      isChatHttpRailVisible(
        { ...configuredSettings, enabled: false },
        "",
        defaultProviderModelCatalogs,
        debugChatEnabled,
      ),
    ).toBe(true);
  });

  it("returns false when HTTP is not configured and Debug AI is disabled", () => {
    expect(
      isChatHttpRailVisible(
        { ...configuredSettings, enabled: false },
        "",
        defaultProviderModelCatalogs,
        debugChatDisabled,
      ),
    ).toBe(false);
  });

  it("returns false when the HTTP connection is disabled and Debug AI is disabled", () => {
    expect(
      isChatHttpRailVisible(
        { ...configuredSettings, enabled: false },
        configuredApiKey,
        defaultProviderModelCatalogs,
        debugChatDisabled,
      ),
    ).toBe(false);
  });

  it("returns false when the API key is missing or whitespace", () => {
    expect(
      isChatHttpRailVisible(configuredSettings, "", defaultProviderModelCatalogs, debugChatDisabled),
    ).toBe(false);
    expect(
      isChatHttpRailVisible(
        configuredSettings,
        "   ",
        defaultProviderModelCatalogs,
        debugChatDisabled,
      ),
    ).toBe(false);
  });

  it("returns false when baseUrl is empty or whitespace", () => {
    expect(
      isChatHttpRailVisible(
        { ...configuredSettings, baseUrl: "" },
        configuredApiKey,
        defaultProviderModelCatalogs,
        debugChatDisabled,
      ),
    ).toBe(false);
    expect(
      isChatHttpRailVisible(
        { ...configuredSettings, baseUrl: "   " },
        configuredApiKey,
        defaultProviderModelCatalogs,
        debugChatDisabled,
      ),
    ).toBe(false);
  });

  it("returns false when the HTTP default model is not resolvable", () => {
    vi.spyOn(providerModelCatalog, "getProviderDefaultModelId").mockReturnValue("");

    expect(
      isChatHttpRailVisible(configuredSettings, configuredApiKey, {
        http: { modelIds: [], defaultModelId: "" },
        "debug-chat": defaultProviderModelCatalogs["debug-chat"],
      } satisfies ProviderModelCatalogs, debugChatDisabled),
    ).toBe(false);
  });

  it("does not apply chat-cloud gating", () => {
    expect(
      isChatHttpRailVisible(configuredSettings, configuredApiKey, {
        ...defaultProviderModelCatalogs,
        "debug-chat": { modelIds: [], defaultModelId: "" },
      }, debugChatDisabled),
    ).toBe(true);
  });
});
