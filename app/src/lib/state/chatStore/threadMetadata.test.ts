import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_HTTP_CONTEXT_ID } from "../../domain/contracts";
import { chatStore, formatCompactionNotice, resetAgentIdCounterForTests } from "../chatStore";
import { DRAFT_AGENT_TITLE } from "../../services/chatAgents";
import type { ChatThreadSnapshot } from "../../domain/contracts";
import { WorkspaceAccessReason, type CapabilityChecker } from "../../ai/capabilities";
import {
  WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
  WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
} from "../../ai/chatErrorCopy";
import {
  deleteAgentPersistence,
  readAgentThreadFileSnapshot,
  readWorkspaceAgentsIndexSnapshot,
} from "../../services/chatPersistence";
import { setChatRetentionMaxTurnsForTests } from "../../services/chatRetention";
import { ensureWorkspaceReadAccess } from "../../services/fileSystem";
import { defaultAppProviderSettings } from "../../ai/providers/appProviderSettings";
import {
  createTestCapabilityChecker,
  registerTestDebugWorkspaceProvider,
} from "../../ai/providers/debugProviderTestHelpers";
import { appState } from "../appState";
import { defaultDebugProviderSettings } from "../../ai/providers/debugProviderSettings";
import { defaultHttpConnectionSettings, DEFAULT_HTTP_CONNECTION_ID } from "../../ai/providers/httpConnectionSettings";
import { defaultProviderModelCatalogs } from "../../ai/providers/providerModelCatalog";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "../../ai/providers/registry";

vi.mock("../../services/chatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/chatPersistence")>();
  return {
    ...actual,
    readAgentThreadFileSnapshot: vi.fn(),
    readWorkspaceAgentsIndexSnapshot: vi.fn(),
    deleteAgentPersistence: vi.fn(),
  };
});

vi.mock("../../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
}));

const readAgentThreadFileSnapshotMock = vi.mocked(readAgentThreadFileSnapshot);
const readWorkspaceAgentsIndexSnapshotMock = vi.mocked(readWorkspaceAgentsIndexSnapshot);
const deleteAgentPersistenceMock = vi.mocked(deleteAgentPersistence);
const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);

function providerSwitchOptions() {
  return {
    providerSettings: appState.getSnapshot().settings.providerSettings,
    providerModelCatalogs: defaultProviderModelCatalogs,
  };
}

describe("chatStore provider switching", () => {
  beforeEach(() => {
    chatStore.reset();
    resetChatProviderRegistryForTests();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    registerTestDebugWorkspaceProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: true,
    }));
    chatStore.setCapabilityChecker(createTestCapabilityChecker());
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });
  });

  it("appends a provider-switched system event and updates metadata", async () => {
    const result = await chatStore.switchThreadProvider("debug-workspace", providerSwitchOptions());

    expect(result.switched).toBe(true);
    expect(chatStore.getMetadata()?.provider).toBe("debug-workspace");
    expect(chatStore.getMessages().at(-1)).toMatchObject({
      role: "system",
      content: "Provider switched from HTTP to Debug Provider.",
      systemEvent: {
        type: "provider-switched",
        fromProvider: "http",
        toProvider: "debug-workspace",
      },
    });
  });

  it("blocks switching to Debug when it is disabled in settings", async () => {
    const result = await chatStore.switchThreadProvider("debug-workspace", {
      ...providerSwitchOptions(),
      providerSettings: { ...appState.getSnapshot().settings.providerSettings, debugWorkspace: { ...appState.getSnapshot().settings.providerSettings.debugWorkspace, enabled: false } },
    });

    expect(result.switched).toBe(false);
    expect(result.message).toContain("Debug Provider");
    expect(chatStore.getMetadata()?.provider).toBe("http");
    expect(chatStore.getMessages()).toHaveLength(0);
  });

  it("supports switching from Debug back to HTTP when both are available", async () => {
    await chatStore.switchThreadProvider("debug-workspace", providerSwitchOptions());

    const result = await chatStore.switchThreadProvider("http", providerSwitchOptions());

    expect(result.switched).toBe(true);
    expect(chatStore.getMetadata()?.provider).toBe("http");
    expect(chatStore.getMessages().at(-1)?.content).toBe(
      "Provider switched from Debug Provider to HTTP.",
    );
  });

  it("blocks provider changes while generating", async () => {
    chatStore.beginTurn("turn-1");

    const result = await chatStore.switchThreadProvider("debug-workspace", providerSwitchOptions());

    expect(result.switched).toBe(false);
    expect(chatStore.getMetadata()?.provider).toBe("http");
  });
});

describe("chatStore model switching", () => {
  beforeEach(() => {
    chatStore.reset();
    resetChatProviderRegistryForTests();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    registerTestDebugWorkspaceProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: true,
    }));
    chatStore.setCapabilityChecker(createTestCapabilityChecker());
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });
  });

  it("appends a model-switched system event and updates metadata", async () => {
    const catalogs = {
      ...defaultProviderModelCatalogs,
      http: {
        modelIds: ["gpt-4o-mini", "gpt-4.1"],
        defaultModelId: "gpt-4o-mini",
      },
    };
    appState.updateHttpConnection(DEFAULT_HTTP_CONNECTION_ID, {
      modelCatalog: catalogs.http,
    });
    chatStore.updateThreadMetadata({ connectionId: DEFAULT_HTTP_CONNECTION_ID });
    const result = await chatStore.switchThreadModel("gpt-4.1", {
      providerSettings: appState.getSnapshot().settings.providerSettings,
      providerModelCatalogs: catalogs,
    });

    expect(result.switched).toBe(true);
    expect(chatStore.getMetadata()?.selectedModelId).toBe("gpt-4.1");
    expect(chatStore.getMessages().at(-1)).toMatchObject({
      role: "system",
      content: "Model switched from gpt-4o-mini to gpt-4.1.",
      systemEvent: {
        type: "model-switched",
        fromModel: "gpt-4o-mini",
        toModel: "gpt-4.1",
      },
    });
  });

  it("blocks model changes while generating", async () => {
    chatStore.beginTurn("turn-1");
    const catalogs = {
      ...defaultProviderModelCatalogs,
      http: {
        modelIds: ["gpt-4o-mini", "gpt-4.1"],
        defaultModelId: "gpt-4o-mini",
      },
    };

    const result = await chatStore.switchThreadModel("gpt-4.1", {
      providerSettings: appState.getSnapshot().settings.providerSettings,
      providerModelCatalogs: catalogs,
    });

    expect(result.switched).toBe(false);
    expect(chatStore.getMetadata()?.selectedModelId).toBeUndefined();
  });

  it("creates a draft agent when switching models without an active agent", async () => {
    chatStore.reset();
    resetChatProviderRegistryForTests();
    chatStore.setCapabilityChecker(createTestCapabilityChecker());
    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);

    const catalogs = {
      ...defaultProviderModelCatalogs,
      http: {
        modelIds: ["GLM-4.5-Air"],
        defaultModelId: "GLM-4.5-Air",
      },
    };
    appState.updateHttpConnection(DEFAULT_HTTP_CONNECTION_ID, {
      modelCatalog: catalogs.http,
    });

    expect(chatStore.getActiveAgentId()).toBeNull();

    const result = await chatStore.switchThreadModel("GLM-4.5-Air", {
      providerSettings: appState.getSnapshot().settings.providerSettings,
      providerModelCatalogs: catalogs,
    });

    expect(result.switched).toBe(true);
    expect(chatStore.getActiveAgentId()).not.toBeNull();
    expect(chatStore.getMetadata()?.selectedModelId).toBe("GLM-4.5-Air");
  });

  it("uses connection catalog default in getActiveChatModel before a thread exists", () => {
    chatStore.reset();
    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    chatStore.createDraftAgent();
    appState.updateHttpConnection(DEFAULT_HTTP_CONNECTION_ID, {
      modelCatalog: {
        modelIds: ["GLM-4.5-Air"],
        defaultModelId: "GLM-4.5-Air",
      },
    });

    expect(
      chatStore.getActiveChatModel(
        defaultProviderModelCatalogs,
        appState.getSnapshot().settings.providerSettings,
      ),
    ).toBe("GLM-4.5-Air");
  });

  it("falls back to target provider default when switching providers", async () => {
    chatStore.updateThreadMetadata({ selectedModelId: "gpt-4.1" });

    const result = await chatStore.switchThreadProvider("debug-workspace", providerSwitchOptions());

    expect(result.switched).toBe(true);
    expect(chatStore.getMetadata()?.provider).toBe("debug-workspace");
    expect(chatStore.getMetadata()?.selectedModelId).toBe("debug-simulator");
  });

  it("keeps the current model on provider switch when valid for the target provider", async () => {
    const sharedCatalogs = {
      ...defaultProviderModelCatalogs,
      http: {
        modelIds: ["shared-model", "gpt-4o-mini"],
        defaultModelId: "shared-model",
      },
      "debug-workspace": {
        modelIds: ["shared-model", "debug-simulator"],
        defaultModelId: "debug-simulator",
      },
    };

    chatStore.updateThreadMetadata({ provider: "http", selectedModelId: "shared-model" });

    const result = await chatStore.switchThreadProvider("debug-workspace", {
      providerSettings: appState.getSnapshot().settings.providerSettings,
      providerModelCatalogs: sharedCatalogs,
    });

    expect(result.switched).toBe(true);
    expect(chatStore.getMetadata()?.selectedModelId).toBe("shared-model");
  });
});
