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
import { scheduleSessionThreadFilePersistence } from "../services/chatPersistence";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";

vi.mock("../services/chatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/chatPersistence")>();
  return {
    ...actual,
    scheduleSessionThreadFilePersistence: vi.fn(),
  };
});

vi.mock("../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
}));

const schedulePersistMock = vi.mocked(scheduleSessionThreadFilePersistence);
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
    appState.applyPersistedSettings({ opencode: { enabled: true } });
    resetChatProviderRegistryForTests();
    resetChatProvidersForTests();
    schedulePersistMock.mockReset();
    ensureWorkspaceReadAccessMock.mockReset();
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
    chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps review mode selected when sending in chat-http", async () => {
    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "review" });

    const resultPromise = sendChatMessage("must be ask-only", undefined, {
      chatContextKind: "chat-http",
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(chatStore.getMetadata()?.mode).toBe("review");
  });

  it("promotes draft agent and schedules persistence on first send", async () => {
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
    const agentId = chatStore.createDraftSession();
    expect(agentId).toBe("session-1");
    expect(chatStore.isSessionDraft(agentId!)).toBe(true);
    chatStore.updateThreadMetadata({ provider: "debug-workspace" });

    const resultPromise = sendChatMessage("Sidebar title from first send");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(chatStore.isSessionDraft(agentId!)).toBe(false);
    expect(chatStore.getSessionTitle(agentId!)).toBe("Sidebar title from first send");
    expect(schedulePersistMock).toHaveBeenCalledTimes(3);
    const persistedSnapshot = schedulePersistMock.mock.calls.at(-1)?.[2];
    expect(persistedSnapshot?.thread.messages.some((message) => message.role === "user")).toBe(true);
  });

  it("returns no_session when send runs without an active draft or session", async () => {
    chatStore.reset();
    chatStore.setActiveWorkspaceRoot("/work/a");

    const result = await sendChatMessage("Hello");

    expect(result).toEqual({
      ok: false,
      reason: "no_session",
      message: "Could not resolve an active session.",
    });
    expect(schedulePersistMock).not.toHaveBeenCalled();
  });

  it("produces structured review output for review mode threads", async () => {
    chatStore.updateThreadMetadata({ mode: "review", provider: "debug-workspace" });

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
        () => appState.getSnapshot().settings.providerSettings,
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
    expect(schedulePersistMock).toHaveBeenCalledTimes(3);
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
        () => appState.getSnapshot().settings.providerSettings,
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
        "Invalid API key for the configured HTTP provider. Check Settings → Dev → Providers (Chat beta).",
      );
    }
    expect(chatStore.getMessages()).toHaveLength(1);
    expect(chatStore.getRuntimeState()).toMatchObject({
      isGenerating: false,
      lastFailedTurnId: expect.stringMatching(/^turn-/),
      lastError: {
        message: "Invalid API key for the configured HTTP provider. Check Settings → Dev → Providers (Chat beta).",
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
        () => appState.getSnapshot().settings.providerSettings,
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
    appState.updateDebugWorkspaceProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debugWorkspace,
      failureProbability: 1,
      failureMessage: "Simulated provider failure",
    });

    const failedPromise = sendChatMessage("Retry me");
    await vi.runAllTimersAsync();
    const failed = await failedPromise;

    expect(failed.ok).toBe(false);
    expect(chatStore.getMessages().filter((message) => message.role === "user")).toHaveLength(1);
    expect(chatStore.canRetryLastTurn()).toBe(true);

    appState.updateDebugWorkspaceProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debugWorkspace,
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
        () => appState.getSnapshot().settings.providerSettings,
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
        () => appState.getSnapshot().settings.providerSettings,
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
    chatStore.updateThreadMetadata({ provider: "debug-workspace", selectedModelId: "unknown-model" });

    const result = await sendChatMessage("Hello");

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_model",
    });
    expect(result.ok === false && result.message).toContain("not configured");
    expect(chatStore.getMessages()).toHaveLength(0);
  });

  it("uses connection catalog default when sending before a thread exists", async () => {
    resetChatProviderRegistryForTests();
    chatStore.reset();
    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    chatStore.createDraftSession();
    appState.updateHttpConnection(DEFAULT_HTTP_CONNECTION_ID, {
      enabled: true,
      modelCatalog: {
        modelIds: ["GLM-4.5-Air"],
        defaultModelId: "GLM-4.5-Air",
      },
    });
    appState.setProviderApiKey(DEFAULT_HTTP_CONNECTION_ID, "http-test-key");
    const httpFetch = httpFetchStreamSuccess("Hello from GLM");
    registerChatProvider(
      createOpenAiCompatibleChatProvider(
        (connectionId) => {
          const snapshot = appState.getSnapshot().settings;
          const resolved = resolveHttpConnection(
            snapshot.providerSettings,
            snapshot.providerApiKeys,
            connectionId,
          );
          return {
            settings: resolved?.connection ?? snapshot.providerSettings.http,
            apiKey: resolved?.apiKey ?? "http-test-key",
          };
        },
        httpFetch,
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
    chatStore.updateThreadMetadata({
      provider: "http",
      mode: "ask",
      connectionId: DEFAULT_HTTP_CONNECTION_ID,
    });

    const sendPromise = sendChatMessage("Hello", undefined, { chatContextKind: "chat-http" });
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(result.ok).toBe(true);
    expect(httpFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"model":"GLM-4.5-Air"'),
      }),
    );
  });

  it("passes the resolved thread model id to the provider adapter", async () => {
    resetChatProviderRegistryForTests();
    const debugProvider = createTestDebugWorkspaceProvider();
    const streamMessageSpy = vi.spyOn(debugProvider, "streamMessage");
    registerChatProvider(debugProvider);
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings,
        () => ({
          settings: appState.getSnapshot().settings.providerSettings.http,
          apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
        }),
      ),
    );

    chatStore.updateThreadMetadata({ provider: "debug-workspace", selectedModelId: "debug-simulator" });

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
    appState.updateHttpConnection(DEFAULT_HTTP_CONNECTION_ID, {
      enabled: true,
      modelCatalog: {
        modelIds: ["gpt-4o-mini"],
        defaultModelId: "gpt-4o-mini",
      },
    });
    appState.setProviderApiKey(DEFAULT_HTTP_CONNECTION_ID, "http-test-key");
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
        () => appState.getSnapshot().settings.providerSettings,
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: "http-test-key",
        }),
      ),
    );
    chatStore.updateThreadMetadata({
      provider: "http",
      mode: "ask",
      selectedModelId: "gpt-4o-mini",
      connectionId: DEFAULT_HTTP_CONNECTION_ID,
    });

    const sendPromise = sendChatMessage("Bad model");
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("provider_error");
    expect(result.ok === false && result.message).toContain("rejected model");
  });
});
