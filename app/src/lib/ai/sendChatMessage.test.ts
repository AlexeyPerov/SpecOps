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
import { promptPermission } from "../services/permissionPrompt";
import { promptQuestion } from "../services/questionPrompt";

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

vi.mock("../services/permissionPrompt", () => ({
  promptPermission: vi.fn(),
}));

vi.mock("../services/questionPrompt", () => ({
  promptQuestion: vi.fn(),
}));

vi.mock("../services/opencodeSidecarEnsure", () => ({
  ensureOpencodeSidecar: vi.fn().mockResolvedValue({
    status: {
      running: true,
      baseUrl: "http://127.0.0.1:4096",
      health: "healthy",
      directory: "/tmp/workspace",
      port: 4096,
      pid: 42,
      lastError: null,
    },
    spawned: true,
  }),
}));

const schedulePersistMock = vi.mocked(scheduleAgentThreadFilePersistence);
const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);
const createWorkspaceAgentBackendMock = vi.mocked(createWorkspaceAgentBackend);
const promptPermissionMock = vi.mocked(promptPermission);
const promptQuestionMock = vi.mocked(promptQuestion);

function ensureWorkspaceContext(root: string): void {
  const snapshot = appState.getSnapshot();
  const existing = snapshot.contexts.workspaces.find((w) => w.rootPath === root);
  if (existing) {
    appState.switchContext(existing.id);
  } else {
    const created = appState.addWorkspace(root);
    if (created) appState.switchContext(created);
  }
}

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
    promptPermissionMock.mockReset();
    promptQuestionMock.mockReset();
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
    chatStore.updateThreadMetadata({ provider: "debug-workspace" });

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

  it("blocks send when workspace access preflight is not ready", async () => {
    const wsId = appState.addWorkspace("/work/a");
    ensureWorkspaceReadAccessMock.mockResolvedValue("blocked");

    const result = await sendChatMessage("Hello");

    if (wsId) {
      appState.closeWorkspace(wsId);
    }

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
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession,
      getSession,
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send,
      replyPermission: vi.fn(),
      replyQuestion: vi.fn(),
      rejectQuestion: vi.fn(),
      abortSession: vi.fn(),
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
      model: undefined,
    });
    expect(
      chatStore.getMessages().find((message) => message.role === "assistant")?.content,
    ).toBe("OpenCode stream");
  });

  it("returns cancelled state for ws-* stream cancellation", async () => {
    appState.addWorkspace("/work/a");
    const getSession = vi.fn().mockResolvedValue({ id: "sess-1" });
    const send = vi.fn().mockResolvedValue({ sessionId: "sess-1" });
    const abortSession = vi.fn().mockResolvedValue(undefined);
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
      replyPermission: vi.fn(),
      replyQuestion: vi.fn(),
      rejectQuestion: vi.fn(),
      abortSession,
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
    expect(abortSession).toHaveBeenCalledWith({
      workspaceRootPath: "/work/a",
      sessionId: "sess-1",
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

  it("skips HTTP provider validation for workspace sends via OpenCode backend", async () => {
    ensureWorkspaceContext("/work/a");
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "");
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: "message.delta", delta: "OpenCode response" };
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession: vi.fn().mockResolvedValue(null),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
      replyPermission: vi.fn(),
      replyQuestion: vi.fn(),
      rejectQuestion: vi.fn(),
      abortSession: vi.fn(),
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);

    const result = await sendChatMessage("No HTTP validation needed");

    expect(result.ok).toBe(true);
    expect(
      chatStore.getMessages().find((m) => m.role === "assistant")?.content,
    ).toBe("OpenCode response");
  });

  it("handles permission.requested event and sends reply to backend", async () => {
    ensureWorkspaceContext("/work/a");
    const replyPermission = vi.fn().mockResolvedValue(undefined);
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: "message.delta", delta: "Starting " };
      yield {
        type: "permission.requested",
        permissionId: "perm-1",
        label: "Run shell: ls",
        payload: { tool: "shell", command: "ls" },
      };
      yield { type: "message.delta", delta: "done" };
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession: vi.fn().mockResolvedValue(null),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
      replyPermission,
      replyQuestion: vi.fn(),
      rejectQuestion: vi.fn(),
      abortSession: vi.fn(),
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    promptPermissionMock.mockResolvedValue({ reply: "once" });

    const result = await sendChatMessage("Needs permission");

    expect(result.ok).toBe(true);
    expect(promptPermissionMock).toHaveBeenCalledWith({
      permissionId: "perm-1",
      label: "Run shell: ls",
      payload: { tool: "shell", command: "ls" },
    });
    expect(replyPermission).toHaveBeenCalledWith({
      workspaceRootPath: "/work/a",
      sessionId: "sess-1",
      requestId: "perm-1",
      reply: "once",
    });
    expect(
      chatStore.getMessages().find((message) => message.role === "assistant")?.content,
    ).toBe("Starting done");
  });

  it("sends reject when permission prompt is denied", async () => {
    ensureWorkspaceContext("/work/a");
    const replyPermission = vi.fn().mockResolvedValue(undefined);
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield {
        type: "permission.requested",
        permissionId: "perm-2",
        label: "Delete file",
        payload: null,
      };
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession: vi.fn().mockResolvedValue(null),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
      replyPermission,
      replyQuestion: vi.fn(),
      rejectQuestion: vi.fn(),
      abortSession: vi.fn(),
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    promptPermissionMock.mockResolvedValue({ reply: "reject" });

    const result = await sendChatMessage("Deny this");

    expect(result.ok).toBe(true);
    expect(replyPermission).toHaveBeenCalledWith({
      workspaceRootPath: "/work/a",
      sessionId: "sess-1",
      requestId: "perm-2",
      reply: "reject",
    });
  });

  it("sends always-allow reply and continues streaming", async () => {
    ensureWorkspaceContext("/work/a");
    const replyPermission = vi.fn().mockResolvedValue(undefined);
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield {
        type: "permission.requested",
        permissionId: "perm-3",
        label: "Read file",
        payload: null,
      };
      yield { type: "message.delta", delta: "allowed" };
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession: vi.fn().mockResolvedValue(null),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
      replyPermission,
      replyQuestion: vi.fn(),
      rejectQuestion: vi.fn(),
      abortSession: vi.fn(),
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    promptPermissionMock.mockResolvedValue({ reply: "always" });

    const result = await sendChatMessage("Always allow");

    expect(result.ok).toBe(true);
    expect(replyPermission).toHaveBeenCalledWith({
      workspaceRootPath: "/work/a",
      sessionId: "sess-1",
      requestId: "perm-3",
      reply: "always",
    });
    expect(
      chatStore.getMessages().find((message) => message.role === "assistant")?.content,
    ).toBe("allowed");
  });

  it("handles multiple permission requests in sequence (FIFO)", async () => {
    ensureWorkspaceContext("/work/a");
    const replyPermission = vi.fn().mockResolvedValue(undefined);
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield {
        type: "permission.requested",
        permissionId: "perm-a",
        label: "First action",
        payload: null,
      };
      yield {
        type: "permission.requested",
        permissionId: "perm-b",
        label: "Second action",
        payload: null,
      };
      yield { type: "message.delta", delta: "both approved" };
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession: vi.fn().mockResolvedValue(null),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
      replyPermission,
      replyQuestion: vi.fn(),
      rejectQuestion: vi.fn(),
      abortSession: vi.fn(),
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    promptPermissionMock.mockResolvedValue({ reply: "once" });

    const result = await sendChatMessage("Multiple permissions");

    expect(result.ok).toBe(true);
    expect(promptPermissionMock).toHaveBeenCalledTimes(2);
    expect(promptPermissionMock).toHaveBeenNthCalledWith(1, {
      permissionId: "perm-a",
      label: "First action",
      payload: null,
    });
    expect(promptPermissionMock).toHaveBeenNthCalledWith(2, {
      permissionId: "perm-b",
      label: "Second action",
      payload: null,
    });
    expect(replyPermission).toHaveBeenCalledTimes(2);
  });

  it("continues stream when permission reply hits notFound", async () => {
    ensureWorkspaceContext("/work/a");
    const { WorkspaceAgentBackendError } = await import("./backends/workspaceAgentBackend");
    const replyPermission = vi.fn().mockRejectedValue(
      new WorkspaceAgentBackendError({ code: "notFound", message: "gone" }),
    );
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield {
        type: "permission.requested",
        permissionId: "perm-gone",
        label: "Stale",
        payload: null,
      };
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession: vi.fn().mockResolvedValue(null),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
      replyPermission,
      replyQuestion: vi.fn(),
      rejectQuestion: vi.fn(),
      abortSession: vi.fn(),
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    promptPermissionMock.mockResolvedValue({ reply: "once" });

    const result = await sendChatMessage("Stale permission");

    expect(result.ok).toBe(true);
  });

  it("sets isWaitingForPermission during permission prompt", async () => {
    ensureWorkspaceContext("/work/a");
    let wasWaitingDuringPrompt = false;
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield {
        type: "permission.requested",
        permissionId: "perm-w",
        label: "Check wait state",
        payload: null,
      };
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession: vi.fn().mockResolvedValue(null),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
      replyPermission: vi.fn().mockResolvedValue(undefined),
      replyQuestion: vi.fn(),
      rejectQuestion: vi.fn(),
      abortSession: vi.fn(),
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    promptPermissionMock.mockImplementation(async () => {
      wasWaitingDuringPrompt = chatStore.getRuntimeState().isWaitingForPermission;
      return { reply: "once" };
    });

    const result = await sendChatMessage("Wait state check");

    expect(result.ok).toBe(true);
    expect(wasWaitingDuringPrompt).toBe(true);
    expect(chatStore.getRuntimeState().isWaitingForPermission).toBe(false);
  });

  it("handles question.requested event and sends reply to backend", async () => {
    ensureWorkspaceContext("/work/a");
    const replyQuestion = vi.fn().mockResolvedValue(undefined);
    const rejectQuestion = vi.fn().mockResolvedValue(undefined);
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: "message.delta", delta: "Thinking " };
      yield {
        type: "question.requested",
        questionId: "q-1",
        prompt: "Which framework?",
        choices: ["React", "Vue", "Svelte"],
        payload: null,
      };
      yield { type: "message.delta", delta: "done" };
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession: vi.fn().mockResolvedValue(null),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
      replyPermission: vi.fn(),
      replyQuestion,
      rejectQuestion,
      abortSession: vi.fn(),
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    promptQuestionMock.mockResolvedValue({ type: "reply", answers: [["React"]] });

    const result = await sendChatMessage("Pick a framework");

    expect(result.ok).toBe(true);
    expect(promptQuestionMock).toHaveBeenCalledWith({
      questionId: "q-1",
      prompt: "Which framework?",
      choices: ["React", "Vue", "Svelte"],
      payload: null,
    });
    expect(replyQuestion).toHaveBeenCalledWith({
      workspaceRootPath: "/work/a",
      sessionId: "sess-1",
      requestId: "q-1",
      answers: [["React"]],
    });
    expect(rejectQuestion).not.toHaveBeenCalled();
    expect(
      chatStore.getMessages().find((message) => message.role === "assistant")?.content,
    ).toBe("Thinking done");
  });

  it("sends reject when question prompt is cancelled", async () => {
    ensureWorkspaceContext("/work/a");
    const replyQuestion = vi.fn().mockResolvedValue(undefined);
    const rejectQuestion = vi.fn().mockResolvedValue(undefined);
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield {
        type: "question.requested",
        questionId: "q-2",
        prompt: "Continue?",
        choices: ["Yes", "No"],
        payload: null,
      };
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession: vi.fn().mockResolvedValue(null),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
      replyPermission: vi.fn(),
      replyQuestion,
      rejectQuestion,
      abortSession: vi.fn(),
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    promptQuestionMock.mockResolvedValue({ type: "reject" });

    const result = await sendChatMessage("Cancel question");

    expect(result.ok).toBe(true);
    expect(rejectQuestion).toHaveBeenCalledWith({
      workspaceRootPath: "/work/a",
      sessionId: "sess-1",
      requestId: "q-2",
    });
    expect(replyQuestion).not.toHaveBeenCalled();
  });

  it("handles multiple question requests in sequence (FIFO)", async () => {
    ensureWorkspaceContext("/work/a");
    const replyQuestion = vi.fn().mockResolvedValue(undefined);
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield {
        type: "question.requested",
        questionId: "q-a",
        prompt: "First question?",
        choices: ["A"],
        payload: null,
      };
      yield {
        type: "question.requested",
        questionId: "q-b",
        prompt: "Second question?",
        choices: ["B"],
        payload: null,
      };
      yield { type: "message.delta", delta: "answered" };
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession: vi.fn().mockResolvedValue(null),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
      replyPermission: vi.fn(),
      replyQuestion,
      rejectQuestion: vi.fn(),
      abortSession: vi.fn(),
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    promptQuestionMock.mockResolvedValue({ type: "reply", answers: [["A"]] });

    const result = await sendChatMessage("Multiple questions");

    expect(result.ok).toBe(true);
    expect(promptQuestionMock).toHaveBeenCalledTimes(2);
    expect(promptQuestionMock).toHaveBeenNthCalledWith(1, {
      questionId: "q-a",
      prompt: "First question?",
      choices: ["A"],
      payload: null,
    });
    expect(promptQuestionMock).toHaveBeenNthCalledWith(2, {
      questionId: "q-b",
      prompt: "Second question?",
      choices: ["B"],
      payload: null,
    });
    expect(replyQuestion).toHaveBeenCalledTimes(2);
  });

  it("continues stream when question reply hits notFound", async () => {
    ensureWorkspaceContext("/work/a");
    const { WorkspaceAgentBackendError } = await import("./backends/workspaceAgentBackend");
    const replyQuestion = vi.fn().mockRejectedValue(
      new WorkspaceAgentBackendError({ code: "notFound", message: "gone" }),
    );
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield {
        type: "question.requested",
        questionId: "q-gone",
        prompt: "Stale?",
        choices: [],
        payload: null,
      };
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession: vi.fn().mockResolvedValue(null),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
      replyPermission: vi.fn(),
      replyQuestion,
      rejectQuestion: vi.fn(),
      abortSession: vi.fn(),
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    promptQuestionMock.mockResolvedValue({ type: "reply", answers: [["ok"]] });

    const result = await sendChatMessage("Stale question");

    expect(result.ok).toBe(true);
  });

  it("sets isWaitingForQuestion during question prompt", async () => {
    ensureWorkspaceContext("/work/a");
    let wasWaitingDuringPrompt = false;
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield {
        type: "question.requested",
        questionId: "q-w",
        prompt: "Check wait state",
        choices: ["Ok"],
        payload: null,
      };
      yield { type: "run.completed" };
    });
    createWorkspaceAgentBackendMock.mockReturnValue({
      id: "opencode",
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      getSession: vi.fn().mockResolvedValue(null),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
      replyPermission: vi.fn(),
      replyQuestion: vi.fn().mockResolvedValue(undefined),
      rejectQuestion: vi.fn(),
      abortSession: vi.fn(),
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    promptQuestionMock.mockImplementation(async () => {
      wasWaitingDuringPrompt = chatStore.getRuntimeState().isWaitingForQuestion;
      return { type: "reply", answers: [["Ok"]] };
    });

    const result = await sendChatMessage("Wait state check");

    expect(result.ok).toBe(true);
    expect(wasWaitingDuringPrompt).toBe(true);
    expect(chatStore.getRuntimeState().isWaitingForQuestion).toBe(false);
  });

});
