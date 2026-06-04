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
    expect(parseModelListInput("gpt-4o-mini\n gpt-4.1 , gpt-4.1-mini ")).toEqual([
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
    ]);
  });

  it("removes empty entries and duplicates", () => {
    expect(parseModelListInput("\n, gpt-4o-mini\n, gpt-4o-mini\n")).toEqual(["gpt-4o-mini"]);
  });
});

describe("normalizeProviderModelCatalog", () => {
  it("falls back to provider defaults for invalid input", () => {
    expect(normalizeProviderModelCatalog("http", undefined)).toEqual(
      defaultProviderModelCatalogs.http,
    );
  });

  it("normalizes invalid default model to first list entry", () => {
    expect(
      normalizeProviderModelCatalog("http", {
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
});

describe("catalog helpers", () => {
  it("formats model lists for settings textarea input", () => {
    expect(formatModelListForInput(["a", "b"])).toBe("a\nb");
  });

  it("checks membership and resolves default model id", () => {
    const catalogs = normalizeProviderModelCatalogs();
    expect(isModelInProviderCatalog(catalogs, "http", "gpt-4o-mini")).toBe(true);
    expect(isModelInProviderCatalog(catalogs, "http", "unknown")).toBe(false);
    expect(getProviderDefaultModelId(catalogs, "debug")).toBe("debug-simulator");
    expect(getProviderModelCatalog(catalogs, "debug").defaultModelId).toBe("debug-simulator");
  });
});
