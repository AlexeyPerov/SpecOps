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

function httpFetchSuccess(content: string): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ) as typeof fetch;
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
    expect(schedulePersistMock).toHaveBeenCalledOnce();
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
    expect(schedulePersistMock).toHaveBeenCalledOnce();
    const persistedSnapshot = schedulePersistMock.mock.calls[0]?.[2];
    const assistant = persistedSnapshot?.thread.messages.find((message) => message.role === "assistant");
    expect(assistant?.content).toContain("simulated answer");
    expect(assistant?.content).toBe(chatStore.getMessages().find((message) => message.role === "assistant")?.content);
  });

  it("uses buffered fallback for HTTP without streaming partial updates", async () => {
    resetChatProviderRegistryForTests();
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    registerChatProvider(
      createOpenAiCompatibleChatProvider(
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
        httpFetchSuccess("Buffered HTTP response."),
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

    const result = await sendChatMessage("Buffered HTTP please");
    unsubscribe();

    expect(result.ok).toBe(true);
    const finalLength = "Buffered HTTP response.".length;
    expect(observedLengths[0]).toBe(0);
    expect(observedLengths.every((length) => length === 0 || length === finalLength)).toBe(true);
    expect(new Set(observedLengths.filter((length) => length > 0))).toEqual(new Set([finalLength]));
    expect(chatStore.getMessages().find((message) => message.role === "assistant")?.content).toBe(
      "Buffered HTTP response.",
    );
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
        httpFetchSuccess("HTTP response about retention."),
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
    expect(schedulePersistMock).toHaveBeenCalledOnce();
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
        new Response(JSON.stringify({ choices: [{ message: { content: "Retried HTTP response." } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
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
