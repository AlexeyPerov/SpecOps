import { describe, expect, it } from "vitest";
import {
  defaultProviderModelCatalogs,
  formatModelListForInput,
  getProviderDefaultModelId,
  getProviderModelCatalog,
  isModelInProviderCatalog,
  normalizeProviderModelCatalog,
  normalizeProviderModelCatalogs,
  parseModelListInput,
} from "./providerModelCatalog";

describe("parseModelListInput", () => {
  it("parses newline and comma separated model ids", () => {
    expect(parseModelListInput("glm-4-flash\n glm-4-plus , glm-4-air ")).toEqual([
      "glm-4-flash",
      "glm-4-plus",
      "glm-4-air",
    ]);
  });

  it("removes empty entries and duplicates", () => {
    expect(parseModelListInput("\n, glm-4-flash\n, glm-4-flash\n")).toEqual(["glm-4-flash"]);
  });
});

describe("normalizeProviderModelCatalog", () => {
  it("falls back to provider defaults for invalid input", () => {
    expect(normalizeProviderModelCatalog("glm", undefined)).toEqual(
      defaultProviderModelCatalogs.glm,
    );
  });

  it("normalizes invalid default model to first list entry", () => {
    expect(
      normalizeProviderModelCatalog("glm", {
        modelIds: ["alpha", "beta"],
        defaultModelId: "missing",
      }),
    ).toEqual({
      modelIds: ["alpha", "beta"],
      defaultModelId: "alpha",
    });
  });

  it("restores defaults when model list is empty after sanitization", () => {
    expect(
      normalizeProviderModelCatalog("debug", {
        modelIds: ["", "  "],
        defaultModelId: "debug-simulator",
      }),
    ).toEqual(defaultProviderModelCatalogs.debug);
  });
});

describe("normalizeProviderModelCatalogs", () => {
  it("returns defaults for all providers", () => {
    expect(normalizeProviderModelCatalogs()).toEqual(defaultProviderModelCatalogs);
  });

  it("migrates legacy glm model id into catalog when catalogs are missing", () => {
    expect(
      normalizeProviderModelCatalogs(undefined, { glmModelId: "legacy-model" }),
    ).toEqual({
      ...defaultProviderModelCatalogs,
      glm: {
        modelIds: ["legacy-model", "glm-4-flash", "glm-4-air", "glm-4-plus"],
        defaultModelId: "legacy-model",
      },
    });
  });

  it("preserves explicit glm catalog default over legacy model id", () => {
    expect(
      normalizeProviderModelCatalogs(
        {
          glm: {
            modelIds: ["glm-4-flash", "glm-4-plus"],
            defaultModelId: "glm-4-plus",
          },
        },
        { glmModelId: "legacy-model" },
      ).glm,
    ).toEqual({
      modelIds: ["glm-4-flash", "glm-4-plus"],
      defaultModelId: "glm-4-plus",
    });
  });
});

describe("catalog helpers", () => {
  it("formats model lists for settings textarea input", () => {
    expect(formatModelListForInput(["a", "b"])).toBe("a\nb");
  });

  it("checks membership and resolves default model id", () => {
    const catalogs = normalizeProviderModelCatalogs();
    expect(isModelInProviderCatalog(catalogs, "glm", "glm-4-flash")).toBe(true);
    expect(isModelInProviderCatalog(catalogs, "glm", "unknown")).toBe(false);
    expect(getProviderDefaultModelId(catalogs, "debug")).toBe("debug-simulator");
    expect(getProviderModelCatalog(catalogs, "cursor").defaultModelId).toBe("auto");
  });
});
