import { describe, expect, it } from "vitest";
import { defaultHttpConnection } from "./httpConnectionSettings";
import { defaultProviderModelCatalogs } from "./providerModelCatalog";
import { defaultAppProviderSettings } from "./appProviderSettings";
import {
  isModelInThreadCatalog,
  resolveComposerModelId,
  resolveThreadCatalogDefaultModelId,
  resolveThreadModelCatalog,
} from "./threadModelCatalog";

describe("threadModelCatalog", () => {
  it("prefers HTTP connection model catalogs over global defaults", () => {
    const settings = {
      ...defaultAppProviderSettings,
      httpConnections: [
        {
          ...defaultHttpConnection,
          id: "conn-glm",
          label: "GLM",
          enabled: true,
          modelCatalog: {
            modelIds: ["GLM-4.7", "GLM-5.1"],
            defaultModelId: "GLM-4.7",
          },
        },
      ],
      defaultConnectionId: "conn-glm",
    };

    expect(
      resolveThreadModelCatalog(defaultProviderModelCatalogs, "http", {
        providerSettings: settings,
        connectionId: "conn-glm",
      }).modelIds,
    ).toEqual(["GLM-4.7", "GLM-5.1"]);

    expect(
      isModelInThreadCatalog(defaultProviderModelCatalogs, "http", "GLM-4.7", {
        providerSettings: settings,
        connectionId: "conn-glm",
      }),
    ).toBe(true);

    expect(
      isModelInThreadCatalog(defaultProviderModelCatalogs, "http", "gpt-4o-mini", {
        providerSettings: settings,
        connectionId: "conn-glm",
      }),
    ).toBe(false);
  });

  it("falls back to global provider catalogs when no connection context is available", () => {
    expect(
      resolveThreadCatalogDefaultModelId(defaultProviderModelCatalogs, "http"),
    ).toBe("gpt-4o-mini");
  });

  it("resolveComposerModelId uses connection default before a thread exists", () => {
    const settings = {
      ...defaultAppProviderSettings,
      defaultConnectionId: "conn-glm",
      httpConnections: [
        {
          ...defaultHttpConnection,
          id: "conn-glm",
          label: "GLM",
          enabled: true,
          modelCatalog: {
            modelIds: ["GLM-4.5-Air"],
            defaultModelId: "GLM-4.5-Air",
          },
        },
      ],
    };

    expect(
      resolveComposerModelId({
        thread: null,
        providerId: "http",
        providerSettings: settings,
        providerModelCatalogs: defaultProviderModelCatalogs,
      }),
    ).toBe("GLM-4.5-Air");
  });
});
