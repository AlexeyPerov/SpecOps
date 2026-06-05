import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderModelCatalogs } from "../../domain/contracts";
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

  it("returns true when all gating conditions pass", () => {
    expect(
      isChatHttpRailVisible(configuredSettings, configuredApiKey, defaultProviderModelCatalogs),
    ).toBe(true);
  });

  it("returns false when the HTTP connection is disabled", () => {
    expect(
      isChatHttpRailVisible(
        { ...configuredSettings, enabled: false },
        configuredApiKey,
        defaultProviderModelCatalogs,
      ),
    ).toBe(false);
  });

  it("returns false when the API key is missing or whitespace", () => {
    expect(
      isChatHttpRailVisible(configuredSettings, "", defaultProviderModelCatalogs),
    ).toBe(false);
    expect(
      isChatHttpRailVisible(configuredSettings, "   ", defaultProviderModelCatalogs),
    ).toBe(false);
  });

  it("returns false when baseUrl is empty or whitespace", () => {
    expect(
      isChatHttpRailVisible(
        { ...configuredSettings, baseUrl: "" },
        configuredApiKey,
        defaultProviderModelCatalogs,
      ),
    ).toBe(false);
    expect(
      isChatHttpRailVisible(
        { ...configuredSettings, baseUrl: "   " },
        configuredApiKey,
        defaultProviderModelCatalogs,
      ),
    ).toBe(false);
  });

  it("returns false when the HTTP default model is not resolvable", () => {
    vi.spyOn(providerModelCatalog, "getProviderDefaultModelId").mockReturnValue("");

    expect(
      isChatHttpRailVisible(configuredSettings, configuredApiKey, {
        http: { modelIds: [], defaultModelId: "" },
        debug: defaultProviderModelCatalogs.debug,
      } satisfies ProviderModelCatalogs),
    ).toBe(false);
  });

  it("does not apply chat-cloud gating", () => {
    expect(
      isChatHttpRailVisible(configuredSettings, configuredApiKey, {
        ...defaultProviderModelCatalogs,
        debug: { modelIds: [], defaultModelId: "" },
      }),
    ).toBe(true);
  });
});
