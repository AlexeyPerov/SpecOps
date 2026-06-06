import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessReason } from "../capabilities";
import { chatStore } from "../../state/chatStore";
import { defaultDebugProviderSettings } from "./debugProviderSettings";
import { defaultHttpConnectionSettings } from "./httpConnectionSettings";
import { initializeChatProviders, resetChatProvidersForTests } from "./bootstrap";
import { createRegistryCapabilityChecker } from "./capabilityChecker";
import { createTestDebugWorkspaceProvider } from "./debugProviderTestHelpers";
import { defaultAppProviderSettings } from "./appProviderSettings";
import { createOpenAiCompatibleChatProvider } from "./openAiCompatibleChatProvider";
import { registerChatProvider, resetChatProviderRegistryForTests } from "./registry";

describe("registry-backed capability checker", () => {
  beforeEach(() => {
    resetChatProviderRegistryForTests();
    chatStore.setCapabilityChecker(null);
    resetChatProvidersForTests();
  });

  it("delegates to registered Debug provider capabilities", async () => {
    registerChatProvider(
      createTestDebugWorkspaceProvider(() => ({
        ...defaultDebugProviderSettings,
        enabled: true,
      })),
    );
    const checker = createRegistryCapabilityChecker(
      () => defaultAppProviderSettings,
      () => ({ settings: defaultHttpConnectionSettings, apiKey: "" }),
    );

    const result = await checker.checkCapabilities({
      provider: "debug-workspace",
      mode: "ask",
      workspaceRootPath: "/work/a",
    });

    expect(result.status).toBe("ready");
    expect(result.capabilities?.supportedModes).toEqual(["ask", "review"]);
  });

  it("reports missing HTTP config when HTTP provider is not registered", async () => {
    const checker = createRegistryCapabilityChecker(
      () => defaultAppProviderSettings,
      () => ({ settings: defaultHttpConnectionSettings, apiKey: "" }),
    );

    const result = await checker.checkCapabilities({
      provider: "http",
      mode: "ask",
      workspaceRootPath: "/work/a",
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(WorkspaceAccessReason.MissingProviderConfig);
  });

  it("delegates to registered HTTP provider when credentials are configured", async () => {
    registerChatProvider(
      createOpenAiCompatibleChatProvider(() => ({
        settings: { ...defaultHttpConnectionSettings, enabled: true },
        apiKey: "test-key",
      })),
    );
    const checker = createRegistryCapabilityChecker(
      () => defaultAppProviderSettings,
      () => ({ settings: { ...defaultHttpConnectionSettings, enabled: true }, apiKey: "test-key" }),
    );

    const result = await checker.checkCapabilities({
      provider: "http",
      mode: "ask",
      workspaceRootPath: "/work/a",
    });

    expect(result.status).toBe("ready");
    expect(result.capabilities?.supportedModes).toEqual(["ask", "review"]);
  });

  it("installs registry-backed checker during provider bootstrap", async () => {
    vi.spyOn(chatStore, "setCapabilityChecker");
    initializeChatProviders();

    expect(chatStore.setCapabilityChecker).toHaveBeenCalledOnce();
  });
});
