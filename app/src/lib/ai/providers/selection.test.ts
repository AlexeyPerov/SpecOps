import { describe, expect, it } from "vitest";
import { defaultAppProviderSettings } from "./appProviderSettings";
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

function providerSettingsWithDebugEnabled(enabled: boolean) {
  return {
    ...defaultAppProviderSettings,
    debugChat: { ...defaultDebugProviderSettings, enabled },
    debugWorkspace: { ...defaultDebugProviderSettings, enabled },
  };
}

describe("chat provider selection", () => {
  it("lists scoped debug providers when enabled and omits HTTP until configured", () => {
    expect(listSelectableChatProviders(providerSettingsWithDebugEnabled(false))).toEqual([]);

    expect(listSelectableChatProviders(providerSettingsWithDebugEnabled(true))).toEqual([
      { id: "debug-workspace", label: "Debug Provider" },
    ]);

    expect(
      listSelectableChatProviders(providerSettingsWithDebugEnabled(true), {
        chatContextKind: "workspace",
        httpConfigured: true,
      }),
    ).toEqual([
      { id: "http", label: "HTTP" },
      { id: "debug-workspace", label: "Debug Provider" },
    ]);
  });

  it("filters chat-http providers by HTTP configuration", () => {
    const enabled = providerSettingsWithDebugEnabled(true);
    expect(
      listSelectableChatProviders(enabled, {
        chatContextKind: "chat-http",
        httpConfigured: false,
      }),
    ).toEqual([{ id: "debug-chat", label: "Debug Provider" }]);

    expect(
      listSelectableChatProviders(enabled, {
        chatContextKind: "chat-http",
        httpConfigured: true,
      }),
    ).toEqual([
      { id: "http", label: "HTTP" },
      { id: "debug-chat", label: "Debug Provider" },
    ]);
  });

  it("requires HTTP configuration before listing HTTP in workspace chat", () => {
    const enabled = providerSettingsWithDebugEnabled(true);
    expect(
      canSelectChatProvider("http", enabled, {
        chatContextKind: "workspace",
        httpConfigured: false,
      }),
    ).toBe(false);
    expect(
      canSelectChatProvider("http", enabled, {
        chatContextKind: "workspace",
        httpConfigured: true,
      }),
    ).toBe(true);
  });

  it("validates provider selectability for chat-http", () => {
    const enabled = providerSettingsWithDebugEnabled(true);
    expect(
      canSelectChatProvider("http", enabled, {
        chatContextKind: "chat-http",
        httpConfigured: false,
      }),
    ).toBe(false);
    expect(
      canSelectChatProvider("http", enabled, {
        chatContextKind: "chat-http",
        httpConfigured: true,
      }),
    ).toBe(true);
    expect(
      canSelectChatProvider("debug-chat", providerSettingsWithDebugEnabled(false), {
        chatContextKind: "chat-http",
        httpConfigured: true,
      }),
    ).toBe(false);
    expect(
      canSelectChatProvider("debug-workspace", enabled, {
        chatContextKind: "chat-http",
        httpConfigured: true,
      }),
    ).toBe(false);
  });

  it("prefers HTTP for new threads when configured, otherwise scoped debug when enabled", () => {
    const enabled = providerSettingsWithDebugEnabled(true);
    expect(
      resolveDefaultChatProvider(
        enabled,
        { chatContextKind: "workspace" },
        isHttpProviderConfigured({ ...defaultHttpConnectionSettings, enabled: true }, "key-123"),
      ),
    ).toBe("http");
    expect(
      resolveDefaultChatProvider(enabled, { chatContextKind: "workspace" }, false),
    ).toBe("debug-workspace");
    expect(
      resolveDefaultChatProvider(
        providerSettingsWithDebugEnabled(false),
        { chatContextKind: "workspace" },
        isHttpProviderConfigured(defaultHttpConnectionSettings, ""),
      ),
    ).toBe("http");
    expect(
      resolveDefaultChatProvider(enabled, { chatContextKind: "chat-http" }, false),
    ).toBe("debug-chat");
  });

  it("does not treat an HTTP adapter as configured without credentials", () => {
    expect(isHttpProviderConfigured(defaultHttpConnectionSettings, "")).toBe(false);
  });

  it("formats provider switch notices for history rendering", () => {
    expect(
      formatProviderSwitchNotice({
        type: "provider-switched",
        fromProvider: "http",
        toProvider: "debug-workspace",
      }),
    ).toBe("Provider switched from HTTP to Debug Provider.");

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
      resolveProviderSwitchModelId(defaultProviderModelCatalogs, "debug-workspace", "gpt-4o-mini"),
    ).toBe("debug-simulator");

    expect(
      resolveProviderSwitchModelId(defaultProviderModelCatalogs, "http", "gpt-4o-mini"),
    ).toBe("gpt-4o-mini");
  });
});
