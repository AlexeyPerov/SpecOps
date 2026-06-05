import { describe, expect, it } from "vitest";
import { defaultDebugProviderSettings } from "./debugProviderSettings";
import { defaultHttpConnectionSettings } from "./httpConnectionSettings";
import {
  canSelectChatProvider,
  formatModelSwitchNotice,
  formatProviderSwitchNotice,
  isHttpProviderConfigured,
  listSelectableChatProviders,
  listSelectableModelsForProvider,
  resolveDefaultChatProvider,
  resolveProviderSwitchModelId,
} from "./selection";
import { defaultProviderModelCatalogs } from "./providerModelCatalog";

describe("chat provider selection", () => {
  it("lists product providers and Debug only when enabled", () => {
    expect(listSelectableChatProviders({ ...defaultDebugProviderSettings, enabled: false })).toEqual([
      { id: "http", label: "HTTP" },
    ]);

    expect(listSelectableChatProviders({ ...defaultDebugProviderSettings, enabled: true })).toEqual([
      { id: "http", label: "HTTP" },
      { id: "debug", label: "Debug" },
    ]);
  });

  it("filters chat-http providers by HTTP configuration", () => {
    expect(
      listSelectableChatProviders(
        { ...defaultDebugProviderSettings, enabled: true },
        { chatContextKind: "chat-http", httpConfigured: false },
      ),
    ).toEqual([{ id: "debug", label: "Debug" }]);

    expect(
      listSelectableChatProviders(
        { ...defaultDebugProviderSettings, enabled: true },
        { chatContextKind: "chat-http", httpConfigured: true },
      ),
    ).toEqual([
      { id: "http", label: "HTTP" },
      { id: "debug", label: "Debug" },
    ]);
  });

  it("validates provider selectability for chat-http", () => {
    expect(
      canSelectChatProvider("http", { ...defaultDebugProviderSettings, enabled: true }, {
        chatContextKind: "chat-http",
        httpConfigured: false,
      }),
    ).toBe(false);
    expect(
      canSelectChatProvider("http", { ...defaultDebugProviderSettings, enabled: true }, {
        chatContextKind: "chat-http",
        httpConfigured: true,
      }),
    ).toBe(true);
    expect(
      canSelectChatProvider("debug", { ...defaultDebugProviderSettings, enabled: false }, {
        chatContextKind: "chat-http",
        httpConfigured: true,
      }),
    ).toBe(false);
  });

  it("prefers HTTP for new threads when configured, otherwise Debug when enabled", () => {
    expect(
      resolveDefaultChatProvider(
        defaultDebugProviderSettings,
        isHttpProviderConfigured({ ...defaultHttpConnectionSettings, enabled: true }, "key-123"),
      ),
    ).toBe("http");
    expect(resolveDefaultChatProvider({ ...defaultDebugProviderSettings, enabled: true }, false)).toBe(
      "debug",
    );
    expect(
      resolveDefaultChatProvider(
        { ...defaultDebugProviderSettings, enabled: false },
        isHttpProviderConfigured(defaultHttpConnectionSettings, ""),
      ),
    ).toBe("http");
  });

  it("does not treat an HTTP adapter as configured without credentials", () => {
    expect(
      isHttpProviderConfigured(defaultHttpConnectionSettings, ""),
    ).toBe(false);
  });

  it("formats provider switch notices for history rendering", () => {
    expect(
      formatProviderSwitchNotice({
        type: "provider-switched",
        fromProvider: "http",
        toProvider: "debug",
      }),
    ).toBe("Provider switched from HTTP to Debug.");

    expect(
      formatProviderSwitchNotice({
        type: "provider-switched",
        fromProvider: null,
        toProvider: "http",
      }),
    ).toBe("Provider switched to HTTP.");
  });

  it("lists selectable models for a provider from settings catalogs", () => {
    expect(listSelectableModelsForProvider(defaultProviderModelCatalogs, "http")).toEqual([
      "gpt-4o-mini",
    ]);
  });

  it("formats model switch notices for history rendering", () => {
    expect(
      formatModelSwitchNotice({
        type: "model-switched",
        fromModel: "gpt-4o-mini",
        toModel: "gpt-4.1-mini",
      }),
    ).toBe("Model switched from gpt-4o-mini to gpt-4.1-mini.");

    expect(
      formatModelSwitchNotice({
        type: "model-switched",
        fromModel: null,
        toModel: "gpt-4o-mini",
      }),
    ).toBe("Model switched to gpt-4o-mini.");
  });

  it("resolves provider-switch model fallback policy", () => {
    expect(
      resolveProviderSwitchModelId(defaultProviderModelCatalogs, "debug", "gpt-4o-mini"),
    ).toBe("debug-simulator");

    expect(
      resolveProviderSwitchModelId(defaultProviderModelCatalogs, "http", "gpt-4o-mini"),
    ).toBe("gpt-4o-mini");
  });
});
