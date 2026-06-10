import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import { chatStore } from "../state/chatStore";
import { appState } from "../state/appState";
import { defaultDebugProviderSettings } from "./providers/debugProviderSettings";
import {
  createTestDebugWorkspaceProvider,
  registerBothTestDebugProviders,
} from "./providers/debugProviderTestHelpers";
import { createOpenAiCompatibleChatProvider } from "./providers/openAiCompatibleChatProvider";
import {
  DEFAULT_HTTP_CONNECTION_ID,
  resolveHttpConnection,
} from "./providers/httpConnectionSettings";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "./providers/registry";
import { createRegistryCapabilityChecker } from "./providers/capabilityChecker";
import { resetChatProvidersForTests } from "./providers/bootstrap";
import { sendChatMessage, retryLastChatTurn } from "./sendChatMessage";
import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";
import { createWorkspaceAgentBackend } from "./backends/workspaceAgentBackend";

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

vi.mock("./backends/workspaceAgentBackend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backends/workspaceAgentBackend")>();
  return {
    ...actual,
    createWorkspaceAgentBackend: vi.fn(),
  };
});

const schedulePersistMock = vi.mocked(scheduleAgentThreadFilePersistence);
const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);
const createWorkspaceAgentBackendMock = vi.mocked(createWorkspaceAgentBackend);

function httpFetchStreamSuccess(content: string): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
  ) as typeof fetch;
}

function makeSseResponse(events: string[]): Response {
  return new Response(events.join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("sendChatMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chatStore.reset();
    resetChatProviderRegistryForTests();
    resetChatProvidersForTests();
    schedulePersistMock.mockReset();
    ensureWorkspaceReadAccessMock.mockReset();
    createWorkspaceAgentBackendMock.mockReset();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    const debugSettings = {
      ...defaultDebugProviderSettings,
      enabled: true,
      simulationSeed: 42,
      delayMsMin: 0,
      delayMsMax: 0,
      chunkCharsMin: 6,
      chunkCharsMax: 6,
      failureProbability: 0,
      includeDiagnostics: false,
    };
    appState.updateDebugWorkspaceProviderSettings(debugSettings);
    appState.updateDebugChatProviderSettings(debugSettings);
    registerBothTestDebugProviders();
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, modelId: "gpt-4o-mini" },
          apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
        }),
      ),
    );
    chatStore.setDefaultChatProviderResolver(() => "debug-workspace");
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" });
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
    expect(schedulePersistMock).toHaveBeenCalledTimes(3);
  });

  it("uses default provider resolver before thread metadata exists", async () => {
    chatStore.reset();
    registerBothTestDebugProviders();
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, modelId: "gpt-4o-mini" },
          apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
        }),
      ),
    );
    chatStore.setDefaultChatProviderResolver(() => "debug-workspace");
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.createDraftAgent();

    const resultPromise = sendChatMessage("First message without metadata");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(chatStore.getMetadata()?.provider).toBe("debug-workspace");
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

  it("persists the completed stream once with full assistant content", async () => {
    const resultPromise = sendChatMessage("Persist after stream");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(schedulePersistMock).toHaveBeenCalledTimes(3);
    const persistedSnapshot = schedulePersistMock.mock.calls.at(-1)?.[2];
    const assistant = persistedSnapshot?.thread.messages.find((message) => message.role === "assistant");
    expect(assistant?.content).toContain("simulated answer");
    expect(assistant?.content).toBe(chatStore.getMessages().find((message) => message.role === "assistant")?.content);
  });

  it("schedules stream persistence on first HTTP chunk and final content at completion", async () => {
    resetChatProviderRegistryForTests();
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    registerChatProvider(
      createOpenAiCompatibleChatProvider(
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
        vi.fn().mockResolvedValue(
          makeSseResponse([
            `data: ${JSON.stringify({ choices: [{ delta: { content: "chunk one " } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: "chunk two" } }] })}\n\n`,
            "data: [DONE]\n\n",
          ]),
        ) as typeof fetch,
      ),
    );
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
      ),
    );
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const result = await sendChatMessage("Persist while streaming");

    expect(result.ok).toBe(true);
    expect(schedulePersistMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    const firstAssistant =
      schedulePersistMock.mock.calls
        .map((call) => call[2].thread.messages.find((message) => message.role === "assistant")?.content ?? "")
        .find((content) => content.length > 0) ?? "";
    const lastAssistant =
      schedulePersistMock.mock.calls.at(-1)?.[2].thread.messages.find((message) => message.role === "assistant")
        ?.content ?? "";
    expect(firstAssistant.length).toBeGreaterThan(0);
    expect(firstAssistant.length).toBeLessThan("chunk one chunk two".length);
    expect(lastAssistant).toBe("chunk one chunk two");
  });

  it("streams HTTP partial updates when the provider supports SSE", async () => {
    resetChatProviderRegistryForTests();
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    registerChatProvider(
      createOpenAiCompatibleChatProvider(
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
        vi.fn().mockResolvedValue(
          makeSseResponse([
            `data: ${JSON.stringify({ choices: [{ delta: { content: "Streamed " } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: "HTTP " } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: "response." } }] })}\n\n`,
            "data: [DONE]\n\n",
          ]),
        ) as typeof fetch,
      ),
    );
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
      ),
    );
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const observedLengths: number[] = [];
    const unsubscribe = chatStore.subscribe(() => {
      const assistant = chatStore.getMessages().find((message) => message.role === "assistant");
      if (assistant) {
        observedLengths.push(assistant.content.length);
      }
    });

    const result = await sendChatMessage("Streamed HTTP please");
    unsubscribe();

    expect(result.ok).toBe(true);
    const finalLength = "Streamed HTTP response.".length;
    expect(observedLengths[0]).toBe(0);
    expect(observedLengths).toContain("Streamed ".length);
    expect(observedLengths).toContain("Streamed HTTP ".length);
    expect(observedLengths.at(-1)).toBe(finalLength);
    expect(chatStore.getMessages().find((message) => message.role === "assistant")?.content).toBe(
      "Streamed HTTP response.",
    );
  });

  it("keeps a single assistant placeholder message id across streaming updates", async () => {
    resetChatProviderRegistryForTests();
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    registerChatProvider(
      createOpenAiCompatibleChatProvider(
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
        vi.fn().mockResolvedValue(
          makeSseResponse([
            `data: ${JSON.stringify({ choices: [{ delta: { content: "One " } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: "message" } }] })}\n\n`,
            "data: [DONE]\n\n",
          ]),
        ) as typeof fetch,
      ),
    );
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
      ),
    );
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const assistantIdsDuringStream = new Set<string>();
    const unsubscribe = chatStore.subscribe(() => {
      for (const message of chatStore.getMessages()) {
        if (message.role === "assistant") {
          assistantIdsDuringStream.add(message.id);
        }
      }
    });

    const result = await sendChatMessage("No duplicate assistant rows");
    unsubscribe();

    expect(result.ok).toBe(true);
    expect(assistantIdsDuringStream.size).toBe(1);
    const assistantMessages = chatStore.getMessages().filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe("One message");
    expect(chatStore.getRuntimeState().isGenerating).toBe(false);
  });

  it("aborts an in-flight HTTP stream when generation is cancelled", async () => {
    resetChatProviderRegistryForTests();
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    const abortSignals: AbortSignal[] = [];
    const sseFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal) {
        abortSignals.push(signal);
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: "partial " } }] })}\n\n`,
            ),
          );
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    registerChatProvider(
      createOpenAiCompatibleChatProvider(
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
        sseFetch as typeof fetch,
      ),
    );
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
      ),
    );
    const agentId = chatStore.getActiveAgentId();
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const sendPromise = sendChatMessage("Cancel streamed HTTP");
    await Promise.resolve();
    expect(chatStore.getRuntimeState().isGenerating).toBe(true);
    expect(agentId).toBeTruthy();
    const cancelled = chatStore.cancelAgentGeneration("/work/a", agentId!);
    expect(cancelled).toBe(true);
    const result = await sendPromise;

    expect(result).toEqual({
      ok: false,
      reason: "generating",
      message: "Response was cancelled.",
    });
    expect(abortSignals).toHaveLength(1);
    expect(abortSignals[0]?.aborted).toBe(true);
    expect(chatStore.getRuntimeState().isGenerating).toBe(false);
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
    appState.updateDebugWorkspaceProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debugWorkspace,
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
    expect(schedulePersistMock).toHaveBeenCalledTimes(2);
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

  it("skips workspace access preflight for chat-http sends", async () => {
    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" });
    ensureWorkspaceReadAccessMock.mockResolvedValue("blocked");

    const resultPromise = sendChatMessage("chat-http still sends");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(chatStore.getMessages()).toHaveLength(2);
    expect(ensureWorkspaceReadAccessMock).not.toHaveBeenCalled();
  });

  it("persists workspace sends under the active workspace scope key", async () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" });

    const sendPromise = sendChatMessage("workspace scope persistence");
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(result.ok).toBe(true);
    expect(schedulePersistMock).toHaveBeenCalled();
    expect(schedulePersistMock.mock.calls.at(-1)?.[0]).toBe("/work/a");
  });

  it("persists chat-http sends under the chat-http scope key", async () => {
    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" });

    const sendPromise = sendChatMessage("chat-http scope persistence", undefined, {
      chatContextKind: "chat-http",
    });
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(result.ok).toBe(true);
    expect(schedulePersistMock).toHaveBeenCalled();
    expect(schedulePersistMock.mock.calls.at(-1)?.[0]).toBe(CHAT_HTTP_CONTEXT_ID);
  });

  it("routes ws-* workspace sends through OpenCode backend streaming", async () => {
    appState.addWorkspace("/work/a");
    const getSession = vi.fn().mockResolvedValue(null);
    const createSession = vi.fn().mockResolvedValue({ id: "sess-1" });
    const send = vi.fn().mockResolvedValue({ sessionId: "sess-1" });
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: "message.delta", delta: "OpenCode " };
      yield { type: "message.delta", delta: "stream" };
      yield { type: "run.completed", runId: null };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession,
      getSession,
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send,
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);

    const result = await sendChatMessage("Route through OpenCode");

    expect(result.ok).toBe(true);
    expect(createWorkspaceAgentBackendMock).toHaveBeenCalledWith("opencode", expect.any(Object));
    expect(getSession).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith({
      workspaceRootPath: "/work/a",
      title: expect.any(String),
    });
    expect(send).toHaveBeenCalledWith({
      prompt: "Route through OpenCode",
      workspaceRootPath: "/work/a",
      sessionId: "sess-1",
      model: "debug-simulator",
    });
    expect(
      chatStore.getMessages().find((message) => message.role === "assistant")?.content,
    ).toBe("OpenCode stream");
  });

  it("returns cancelled state for ws-* stream cancellation", async () => {
    appState.addWorkspace("/work/a");
    const getSession = vi.fn().mockResolvedValue({ id: "sess-1" });
    const send = vi.fn().mockResolvedValue({ sessionId: "sess-1" });
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: "message.delta", delta: "partial " };
      await Promise.resolve();
      yield { type: "message.delta", delta: "tail" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession,
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send,
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    chatStore.setAgentSessionLink(chatStore.getActiveAgentId()!, { opencodeSessionId: "sess-1" }, "/work/a");

    const sendPromise = sendChatMessage("Cancel OpenCode stream");
    await Promise.resolve();
    const cancelled = chatStore.cancelAgentGeneration("/work/a", chatStore.getActiveAgentId()!);
    expect(cancelled).toBe(true);

    const result = await sendPromise;
    expect(result).toEqual({
      ok: false,
      reason: "generating",
      message: "Response was cancelled.",
    });
    expect(chatStore.getRuntimeState().isGenerating).toBe(false);
  });

  it("does not use workspace backend for chat-http sends", async () => {
    appState.switchContext("chat-http");
    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" });

    const resultPromise = sendChatMessage("chat-http should stay provider", undefined, {
      chatContextKind: "chat-http",
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(createWorkspaceAgentBackendMock).not.toHaveBeenCalled();
  });

});
