import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessReason } from "../capabilities";
import { chatStore } from "../../state/chatStore";
import { defaultDebugProviderSettings } from "./debugProviderSettings";
import { defaultGlmProviderSettings } from "./glmProviderSettings";
import { initializeChatProviders, resetChatProvidersForTests } from "./bootstrap";
import { createRegistryCapabilityChecker } from "./capabilityChecker";
import { createDebugChatProvider } from "./debugChatProvider";
import { createGlmChatProvider } from "./glmChatProvider";
import { registerChatProvider, resetChatProviderRegistryForTests } from "./registry";

describe("registry-backed capability checker", () => {
  beforeEach(() => {
    resetChatProviderRegistryForTests();
    chatStore.setCapabilityChecker(null);
    resetChatProvidersForTests();
  });

  it("delegates to registered Debug provider capabilities", async () => {
    registerChatProvider(
      createDebugChatProvider(() => ({
        ...defaultDebugProviderSettings,
        enabled: true,
      })),
    );
    const checker = createRegistryCapabilityChecker(
      () => defaultDebugProviderSettings,
      () => ({ settings: defaultGlmProviderSettings, apiKey: "" }),
    );

    const result = await checker.checkCapabilities({
      provider: "debug",
      mode: "ask",
      workspaceRootPath: "/work/a",
    });

    expect(result.status).toBe("ready");
    expect(result.capabilities?.supportedModes).toEqual(["ask", "review"]);
  });

  it("reports missing GLM config when GLM is not registered", async () => {
    const checker = createRegistryCapabilityChecker(
      () => defaultDebugProviderSettings,
      () => ({ settings: defaultGlmProviderSettings, apiKey: "" }),
    );

    const result = await checker.checkCapabilities({
      provider: "glm",
      mode: "ask",
      workspaceRootPath: "/work/a",
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(WorkspaceAccessReason.MissingProviderConfig);
  });

  it("delegates to registered GLM provider when credentials are configured", async () => {
    registerChatProvider(
      createGlmChatProvider(() => ({
        settings: defaultGlmProviderSettings,
        apiKey: "test-key",
      })),
    );
    const checker = createRegistryCapabilityChecker(
      () => defaultDebugProviderSettings,
      () => ({ settings: defaultGlmProviderSettings, apiKey: "test-key" }),
    );

    const result = await checker.checkCapabilities({
      provider: "glm",
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
