import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../domain/contracts";
import { chatStore } from "../state/chatStore";
import { appState } from "../state/appState";
import { defaultDebugProviderSettings } from "./providers/debugProviderSettings";
import { defaultGlmProviderSettings } from "./providers/glmProviderSettings";
import { createDebugChatProvider } from "./providers/debugChatProvider";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "./providers/registry";
import { createRegistryCapabilityChecker } from "./providers/capabilityChecker";
import { resetChatProvidersForTests } from "./providers/bootstrap";
import { sendChatMessage } from "./sendChatMessage";
import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";

vi.mock("../services/chatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/chatPersistence")>();
  return {
    ...actual,
    scheduleAgentThreadFilePersistence: vi.fn(),
  };
});

vi.mock("../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
}));

const schedulePersistMock = vi.mocked(scheduleAgentThreadFilePersistence);
const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);

describe("sendChatMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chatStore.reset();
    resetChatProviderRegistryForTests();
    resetChatProvidersForTests();
    schedulePersistMock.mockReset();
    ensureWorkspaceReadAccessMock.mockReset();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    appState.updateDebugProviderSettings({
      ...defaultDebugProviderSettings,
      enabled: true,
      simulationSeed: 42,
      delayMsMin: 0,
      delayMsMax: 0,
      chunkCharsMin: 6,
      chunkCharsMax: 6,
      failureProbability: 0,
      includeDiagnostics: false,
    });
    registerChatProvider(createDebugChatProvider(() => appState.getSnapshot().settings.debugProvider));
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.debugProvider,
        () => ({
          settings: appState.getSnapshot().settings.glmProvider,
          apiKey: appState.getSnapshot().settings.glmApiKey,
        }),
      ),
    );
    chatStore.setDefaultChatProviderResolver(() => "debug");
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs end-to-end ask conversation with Debug provider", async () => {
    const resultPromise = sendChatMessage("How does retention work?");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(chatStore.getMessages()).toHaveLength(2);
    expect(chatStore.getMessages()[0]).toMatchObject({
      role: "user",
      content: "How does retention work?",
    });
    expect(chatStore.getMessages()[1].role).toBe("assistant");
    expect(chatStore.getMessages()[1].content).toContain("simulated answer");
    expect(chatStore.getRuntimeState().isGenerating).toBe(false);
    expect(schedulePersistMock).toHaveBeenCalledOnce();
  });

  it("uses default provider resolver before thread metadata exists", async () => {
    chatStore.reset();
    registerChatProvider(createDebugChatProvider(() => appState.getSnapshot().settings.debugProvider));
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.debugProvider,
        () => ({
          settings: appState.getSnapshot().settings.glmProvider,
          apiKey: appState.getSnapshot().settings.glmApiKey,
        }),
      ),
    );
    chatStore.setDefaultChatProviderResolver(() => "debug");
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.createDraftAgent();

    const resultPromise = sendChatMessage("First message without metadata");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(chatStore.getMetadata()?.provider).toBe("debug");
  });

  it("streams partial assistant updates during generation", async () => {
    const observedLengths: number[] = [];
    const unsubscribe = chatStore.subscribe(() => {
      const assistant = chatStore.getMessages().find((message) => message.role === "assistant");
      if (assistant) {
        observedLengths.push(assistant.content.length);
      }
    });

    const resultPromise = sendChatMessage("Stream please");
    await vi.runAllTimersAsync();
    await resultPromise;
    unsubscribe();

    expect(observedLengths.length).toBeGreaterThan(1);
    expect(new Set(observedLengths).size).toBeGreaterThan(1);
  });

  it("prevents duplicate sends while generating", async () => {
    const firstPromise = sendChatMessage("First");
    const second = await sendChatMessage("Second");

    expect(second).toEqual({
      ok: false,
      reason: "generating",
      message: "Another response is already in progress.",
    });

    await vi.runAllTimersAsync();
    await firstPromise;
    expect(chatStore.getMessages().filter((message) => message.role === "user")).toHaveLength(1);
  });

  it("records failed turns in retry scaffolding on simulated provider failure", async () => {
    appState.updateDebugProviderSettings({
      ...appState.getSnapshot().settings.debugProvider,
      failureProbability: 1,
      failureMessage: "Simulated provider failure",
    });

    const resultPromise = sendChatMessage("This should fail");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Simulated provider failure");
    }
    expect(chatStore.getMessages()).toHaveLength(1);
    expect(chatStore.getMessages()[0].role).toBe("user");
    expect(chatStore.getRuntimeState()).toMatchObject({
      isGenerating: false,
      lastFailedTurnId: expect.stringMatching(/^turn-/),
      lastError: { message: "Simulated provider failure", code: "provider_error" },
    });
    expect(chatStore.canRetryLastTurn()).toBe(true);
    expect(schedulePersistMock).toHaveBeenCalledOnce();
  });

  it("blocks send when access preflight is not ready", async () => {
    ensureWorkspaceReadAccessMock.mockResolvedValue("blocked");

    const result = await sendChatMessage("Hello");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("preflight");
    }
    expect(chatStore.getMessages()).toHaveLength(0);
    expect(chatStore.getRuntimeState().isGenerating).toBe(false);
  });

  it("promotes draft agent and schedules persistence on first send", async () => {
    chatStore.reset();
    registerChatProvider(createDebugChatProvider(() => appState.getSnapshot().settings.debugProvider));
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.debugProvider,
        () => ({
          settings: appState.getSnapshot().settings.glmProvider,
          apiKey: appState.getSnapshot().settings.glmApiKey,
        }),
      ),
    );
    chatStore.setDefaultChatProviderResolver(() => "debug");
    chatStore.setActiveWorkspaceRoot("/work/a");
    const agentId = chatStore.createDraftAgent();
    expect(agentId).toBe("agent-1");
    expect(chatStore.isAgentDraft(agentId!)).toBe(true);

    const resultPromise = sendChatMessage("Sidebar title from first send");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(chatStore.isAgentDraft(agentId!)).toBe(false);
    expect(chatStore.getAgentTitle(agentId!)).toBe("Sidebar title from first send");
    expect(schedulePersistMock).toHaveBeenCalledOnce();
    const persistedSnapshot = schedulePersistMock.mock.calls[0]?.[2];
    expect(persistedSnapshot?.thread.messages.some((message) => message.role === "user")).toBe(true);
  });

  it("returns no_agent when send runs without an active draft or agent", async () => {
    chatStore.reset();
    chatStore.setActiveWorkspaceRoot("/work/a");

    const result = await sendChatMessage("Hello");

    expect(result).toEqual({
      ok: false,
      reason: "no_agent",
      message: "Could not resolve an active agent.",
    });
    expect(schedulePersistMock).not.toHaveBeenCalled();
  });

  it("produces structured review output for review mode threads", async () => {
    chatStore.updateThreadMetadata({ mode: "review", provider: "debug" });

    const resultPromise = sendChatMessage("Review this idea");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    const assistant = chatStore.getMessages().find((message: ChatMessage) => message.role === "assistant");
    expect(assistant?.content).toContain("## Summary");
    expect(assistant?.content).toContain("T-shirt size");
  });
});
