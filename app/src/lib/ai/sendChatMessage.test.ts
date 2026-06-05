import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import { chatStore } from "../state/chatStore";
import { appState } from "../state/appState";
import { defaultDebugProviderSettings } from "./providers/debugProviderSettings";
import { createDebugChatProvider } from "./providers/debugChatProvider";
import { createOpenAiCompatibleChatProvider } from "./providers/openAiCompatibleChatProvider";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "./providers/registry";
import { createRegistryCapabilityChecker } from "./providers/capabilityChecker";
import { resetChatProvidersForTests } from "./providers/bootstrap";
import { sendChatMessage, retryLastChatTurn } from "./sendChatMessage";
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
    registerChatProvider(createDebugChatProvider(() => appState.getSnapshot().settings.providerSettings.debug));
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings.debug,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, modelId: "gpt-4o-mini" },
          apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
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
    expect(schedulePersistMock).toHaveBeenCalledTimes(2);
  });

  it("uses default provider resolver before thread metadata exists", async () => {
    chatStore.reset();
    registerChatProvider(createDebugChatProvider(() => appState.getSnapshot().settings.providerSettings.debug));
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings.debug,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, modelId: "gpt-4o-mini" },
          apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
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

  it("persists the completed stream once with full assistant content", async () => {
    const resultPromise = sendChatMessage("Persist after stream");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(schedulePersistMock).toHaveBeenCalledTimes(2);
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
        () => appState.getSnapshot().settings.providerSettings.debug,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
      ),
    );
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const result = await sendChatMessage("Persist while streaming");

    expect(result.ok).toBe(true);
    expect(schedulePersistMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const firstAssistant =
      schedulePersistMock.mock.calls[0]?.[2].thread.messages.find((message) => message.role === "assistant")
        ?.content ?? "";
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
        () => appState.getSnapshot().settings.providerSettings.debug,
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
        () => appState.getSnapshot().settings.providerSettings.debug,
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
        () => appState.getSnapshot().settings.providerSettings.debug,
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
    appState.updateDebugProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debug,
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

  it("skips workspace access preflight for chat-http sends", async () => {
    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" });
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
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" });

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
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" });

    const sendPromise = sendChatMessage("chat-http scope persistence", undefined, {
      chatContextKind: "chat-http",
    });
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(result.ok).toBe(true);
    expect(schedulePersistMock).toHaveBeenCalled();
    expect(schedulePersistMock.mock.calls.at(-1)?.[0]).toBe(CHAT_HTTP_CONTEXT_ID);
  });

  it("normalizes review mode to ask before sending in chat-http", async () => {
    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug", mode: "review" });

    const resultPromise = sendChatMessage("must be ask-only", undefined, {
      chatContextKind: "chat-http",
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(chatStore.getMetadata()?.mode).toBe("ask");
  });

  it("promotes draft agent and schedules persistence on first send", async () => {
    chatStore.reset();
    registerChatProvider(createDebugChatProvider(() => appState.getSnapshot().settings.providerSettings.debug));
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings.debug,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, modelId: "gpt-4o-mini" },
          apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
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
    expect(schedulePersistMock).toHaveBeenCalledTimes(2);
    const persistedSnapshot = schedulePersistMock.mock.calls.at(-1)?.[2];
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

  it("runs end-to-end ask conversation with HTTP provider", async () => {
    resetChatProviderRegistryForTests();
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    registerChatProvider(
      createOpenAiCompatibleChatProvider(
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
        httpFetchStreamSuccess("HTTP response about retention."),
      ),
    );
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings.debug,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
      ),
    );
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const result = await sendChatMessage("How does retention work?");

    expect(result.ok).toBe(true);
    expect(chatStore.getMessages()).toHaveLength(2);
    expect(chatStore.getMessages()[1].content).toBe("HTTP response about retention.");
    expect(chatStore.getRuntimeState().isGenerating).toBe(false);
    expect(schedulePersistMock).toHaveBeenCalledTimes(2);
  });

  it("records HTTP provider errors in retry scaffolding", async () => {
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
          new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }),
        ) as typeof fetch,
      ),
    );
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings.debug,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
      ),
    );
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const result = await sendChatMessage("This should fail");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(
        "Invalid API key for the configured HTTP provider. Check Settings → Connections.",
      );
    }
    expect(chatStore.getMessages()).toHaveLength(1);
    expect(chatStore.getRuntimeState()).toMatchObject({
      isGenerating: false,
      lastFailedTurnId: expect.stringMatching(/^turn-/),
      lastError: {
        message: "Invalid API key for the configured HTTP provider. Check Settings → Connections.",
        code: "provider_error",
      },
    });
    expect(chatStore.canRetryLastTurn()).toBe(true);
  });

  it("surfaces stream parse failures with retry scaffolding and no partial assistant residue", async () => {
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
            `data: ${JSON.stringify({ choices: [{ delta: { content: "partial " } }] })}\n\n`,
            "data: {bad-json}\n\n",
          ]),
        ) as typeof fetch,
      ),
    );
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings.debug,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
      ),
    );
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const result = await sendChatMessage("This stream should fail");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("HTTP provider returned an invalid streaming response. Try again.");
    }
    const messages = chatStore.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages.some((message) => message.role === "assistant")).toBe(false);
    expect(chatStore.getRuntimeState()).toMatchObject({
      isGenerating: false,
      lastFailedTurnId: expect.stringMatching(/^turn-/),
      lastError: {
        message: "HTTP provider returned an invalid streaming response. Try again.",
        code: "provider_error",
      },
    });
    expect(chatStore.canRetryLastTurn()).toBe(true);
  });

  it("retries the last failed turn without duplicating user messages", async () => {
    appState.updateDebugProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debug,
      failureProbability: 1,
      failureMessage: "Simulated provider failure",
    });

    const failedPromise = sendChatMessage("Retry me");
    await vi.runAllTimersAsync();
    const failed = await failedPromise;

    expect(failed.ok).toBe(false);
    expect(chatStore.getMessages().filter((message) => message.role === "user")).toHaveLength(1);
    expect(chatStore.canRetryLastTurn()).toBe(true);

    appState.updateDebugProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debug,
      failureProbability: 0,
    });

    const retryPromise = retryLastChatTurn();
    await vi.runAllTimersAsync();
    const retried = await retryPromise;

    expect(retried.ok).toBe(true);
    expect(chatStore.getMessages().filter((message) => message.role === "user")).toHaveLength(1);
    expect(chatStore.getMessages().some((message) => message.role === "assistant")).toBe(true);
    expect(chatStore.getMessages().some((message) => message.content.includes("Previous response failed"))).toBe(
      true,
    );
    expect(chatStore.getRuntimeState()).toMatchObject({
      isGenerating: false,
      lastFailedTurnId: null,
      lastError: null,
    });
    expect(chatStore.canRetryLastTurn()).toBe(false);
  });

  it("returns no_failed_turn when retry runs without a failed response", async () => {
    const result = await retryLastChatTurn();

    expect(result).toEqual({
      ok: false,
      reason: "no_failed_turn",
      message: "There is no failed response to retry.",
    });
  });

  it("retries failed HTTP turns successfully", async () => {
    resetChatProviderRegistryForTests();
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    const httpFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Retried HTTP response." } }] })}\n\ndata: [DONE]\n\n`,
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        ),
      );
    registerChatProvider(
      createOpenAiCompatibleChatProvider(
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
        httpFetch as typeof fetch,
      ),
    );
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings.debug,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
      ),
    );
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const failed = await sendChatMessage("Retry HTTP");
    expect(failed.ok).toBe(false);
    expect(chatStore.getMessages().filter((message) => message.role === "user")).toHaveLength(1);

    const retried = await retryLastChatTurn();
    expect(retried.ok).toBe(true);
    expect(chatStore.getMessages().filter((message) => message.role === "user")).toHaveLength(1);
    expect(chatStore.getMessages().find((message) => message.role === "assistant")?.content).toBe(
      "Retried HTTP response.",
    );
    expect(chatStore.canRetryLastTurn()).toBe(false);
  });

  it("retries after an HTTP stream parse failure and preserves single user message", async () => {
    resetChatProviderRegistryForTests();
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    const httpFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeSseResponse([
          `data: ${JSON.stringify({ choices: [{ delta: { content: "partial " } }] })}\n\n`,
          "data: {bad-json}\n\n",
        ]),
      )
      .mockResolvedValueOnce(
        makeSseResponse([
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Retried " } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: "stream response." } }] })}\n\n`,
          "data: [DONE]\n\n",
        ]),
      );
    registerChatProvider(
      createOpenAiCompatibleChatProvider(
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
        httpFetch as typeof fetch,
      ),
    );
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings.debug,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
      ),
    );
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const failed = await sendChatMessage("Retry failed stream");
    expect(failed.ok).toBe(false);
    expect(chatStore.getMessages().filter((message) => message.role === "user")).toHaveLength(1);
    expect(chatStore.getMessages().filter((message) => message.role === "assistant")).toHaveLength(0);
    expect(chatStore.canRetryLastTurn()).toBe(true);

    const retried = await retryLastChatTurn();
    expect(retried.ok).toBe(true);
    expect(chatStore.getMessages().filter((message) => message.role === "user")).toHaveLength(1);
    expect(chatStore.getMessages().find((message) => message.role === "assistant")?.content).toBe(
      "Retried stream response.",
    );
    expect(chatStore.canRetryLastTurn()).toBe(false);
  });

  it("blocks send when the selected model is not in the configured provider catalog", async () => {
    chatStore.updateThreadMetadata({ provider: "debug", selectedModelId: "unknown-model" });

    const result = await sendChatMessage("Hello");

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_model",
    });
    expect(result.ok === false && result.message).toContain("not configured");
    expect(chatStore.getMessages()).toHaveLength(0);
  });

  it("passes the resolved thread model id to the provider adapter", async () => {
    resetChatProviderRegistryForTests();
    const debugProvider = createDebugChatProvider(() => appState.getSnapshot().settings.providerSettings.debug);
    const streamMessageSpy = vi.spyOn(debugProvider, "streamMessage");
    registerChatProvider(debugProvider);

    chatStore.updateThreadMetadata({ provider: "debug", selectedModelId: "debug-simulator" });

    const sendPromise = sendChatMessage("Model check");
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(result.ok).toBe(true);
    expect(streamMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "debug-simulator",
      }),
    );
  });

  it("maps HTTP provider model rejection to invalid-model copy", async () => {
    resetChatProviderRegistryForTests();
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    const httpFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Model not found" } }), { status: 404 }),
    );
    registerChatProvider(
      createOpenAiCompatibleChatProvider(
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
        httpFetch as typeof fetch,
      ),
    );
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings.debug,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
      ),
    );
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask", selectedModelId: "gpt-4o-mini" });

    const sendPromise = sendChatMessage("Bad model");
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("provider_error");
    expect(result.ok === false && result.message).toContain("rejected model");
  });
});
