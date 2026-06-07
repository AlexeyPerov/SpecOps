import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatStore } from "./chatStore";
import { sendChatMessage } from "../ai/sendChatMessage";
import { registerTestDebugWorkspaceProvider, createTestCapabilityChecker } from "../ai/providers/debugProviderTestHelpers";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "../ai/providers/registry";
import { createRegistryCapabilityChecker } from "../ai/providers/capabilityChecker";
import { resetChatProvidersForTests } from "../ai/providers/bootstrap";
import { defaultDebugProviderSettings } from "../ai/providers/debugProviderSettings";
import { defaultProviderModelCatalogs } from "../ai/providers/providerModelCatalog";
import { appState } from "./appState";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";
import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";

vi.mock("../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
}));

vi.mock("../services/chatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/chatPersistence")>();
  return {
    ...actual,
    scheduleAgentThreadFilePersistence: vi.fn(),
  };
});

const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);
const schedulePersistMock = vi.mocked(scheduleAgentThreadFilePersistence);

describe("M6-4 edge-case transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chatStore.reset();
    resetChatProviderRegistryForTests();
    resetChatProvidersForTests();
    ensureWorkspaceReadAccessMock.mockReset();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    schedulePersistMock.mockReset();

    appState.updateDebugWorkspaceProviderSettings({
      ...defaultDebugProviderSettings,
      enabled: true,
      simulationSeed: 42,
      delayMsMin: 50,
      delayMsMax: 50,
      chunkCharsMin: 4,
      chunkCharsMax: 4,
      failureProbability: 0,
      includeDiagnostics: false,
    });
    registerTestDebugWorkspaceProvider();
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings,
        () => ({
          settings: appState.getSnapshot().settings.providerSettings.http,
          apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
        }),
      ),
    );
    chatStore.setDefaultChatProviderResolver(() => "debug-workspace");
    chatStore.setActiveWorkspaceRoot("/work/a");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels in-flight generation and removes the partial assistant placeholder", () => {
    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentId!);
    chatStore.appendMessage(
      {
        id: "user-1",
        role: "user",
        content: "Hello",
        createdAt: "2026-05-28T12:00:00.000Z",
      },
      { agentId: agentId! },
    );
    chatStore.beginTurn("turn-1", agentId!);
    chatStore.appendMessage(
      {
        id: "assistant-turn-1",
        role: "assistant",
        content: "Partial",
        createdAt: "2026-05-28T12:00:01.000Z",
      },
      { agentId: agentId!, skipCompaction: true },
    );

    expect(chatStore.cancelAgentGeneration("/work/a", agentId!)).toBe(true);
    expect(chatStore.getRuntimeState(agentId!, "/work/a")).toMatchObject({
      isGenerating: false,
      activeTurnId: null,
    });
    expect(
      chatStore.getWorkspaceAgentsState("/work/a")?.threadsByAgentId[agentId!]?.messages.some(
        (message) => message.id === "assistant-turn-1",
      ),
    ).toBe(false);
  });

  it("clears failed retry state when switching providers", async () => {
    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" }, undefined, agentId!);
    chatStore.beginTurn("turn-fail", agentId!);
    chatStore.failTurn({ message: "Provider failed" }, "turn-fail", agentId!);

    expect(chatStore.canRetryLastTurn(agentId!)).toBe(true);

    const result = await chatStore.switchThreadProvider("debug-workspace",
      {
        providerSettings: appState.getSnapshot().settings.providerSettings,
        providerModelCatalogs: defaultProviderModelCatalogs,
      },
      agentId!,
    );

    expect(result.switched).toBe(true);
    expect(chatStore.canRetryLastTurn(agentId!)).toBe(false);
    expect(chatStore.getRuntimeState(agentId!)).toMatchObject({
      lastFailedTurnId: null,
      lastError: null,
    });
  });

  it("does not leave isGenerating stuck after workspace cancellation during send", async () => {
    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentId!);

    const sendPromise = sendChatMessage("Hold please", agentId!);
    await Promise.resolve();
    expect(chatStore.getRuntimeState(agentId!, "/work/a").isGenerating).toBe(true);

    chatStore.cancelAllGenerations("/work/a");
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("generating");
    }
    expect(chatStore.getRuntimeState(agentId!, "/work/a").isGenerating).toBe(false);
  });
});
