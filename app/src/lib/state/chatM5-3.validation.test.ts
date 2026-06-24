/**
 * M5.3 milestone validation — automated exit-criteria checks for HTTP in agent tabs.
 *
 * Manual smoke (workspace UI; not covered here):
 * - Enable Debug in Developer Settings; ask + review in agent tab with streaming visible
 * - Two agents: one Debug, one HTTP generating concurrently (when HTTP configured)
 * - Toggle Debug failure probability; confirm inline error + retry scaffolding state
 * - Disable Debug with agent on Debug provider; confirm send blocked with hint
 * - HTTP ask + review when credentials configured in Settings → HTTP
 * - Provider switch event persists in agent thread after restart
 *
 * Optional manual HTTP integration smoke (requires network + credentials):
 * - Enter API key in Settings → Dev → Providers (Chat beta, stored in provider-secrets.json, never in settings.json or thread files)
 * - Defaults: base URL https://open.bigmodel.cn/api/paas/v4, model gpt-4o-mini
 * - Send ask and review messages; verify assistant replies persist after app restart
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessReason } from "../ai/capabilities";
import {
  DEBUG_AGENT_PROVIDER_DISABLED_MESSAGE,
  HTTP_MISSING_CONFIG_MESSAGE,
} from "../ai/chatErrorCopy";
import { sendChatMessage } from "../ai/sendChatMessage";
import { registerTestDebugWorkspaceProvider, createTestCapabilityChecker } from "../ai/providers/debugProviderTestHelpers";
import { defaultDebugProviderSettings } from "../ai/providers/debugProviderSettings";
import { defaultProviderModelCatalogs } from "../ai/providers/providerModelCatalog";
import { createOpenAiCompatibleChatProvider } from "../ai/providers/openAiCompatibleChatProvider";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "../ai/providers/registry";
import { createRegistryCapabilityChecker } from "../ai/providers/capabilityChecker";
import { resetChatProvidersForTests } from "../ai/providers/bootstrap";
import { scheduleSessionThreadFilePersistence } from "../services/chatPersistence";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";
import { appState } from "./appState";
import { chatStore } from "./chatStore";

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

function httpFetchSuccess(content: string): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
  ) as typeof fetch;
}

function registerProviders(includeHttp = false): void {
  resetChatProviderRegistryForTests();
  registerTestDebugWorkspaceProvider();
  if (includeHttp) {
    registerChatProvider(
      createOpenAiCompatibleChatProvider(
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
        }),
        httpFetchSuccess("HTTP buffered response."),
      ),
    );
  }
  chatStore.setCapabilityChecker(
    createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings,
        () => ({
        settings: { ...appState.getSnapshot().settings.providerSettings.http, modelId: "gpt-4o-mini" },
        apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
      }),
    ),
  );
}

describe("M5.3 milestone validation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chatStore.reset();
    resetChatProvidersForTests();
    schedulePersistMock.mockReset();
    ensureWorkspaceReadAccessMock.mockReset();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    appState.updateDebugWorkspaceProviderSettings({
      ...defaultDebugProviderSettings,
      enabled: true,
      simulationSeed: 11,
      delayMsMin: 30,
      delayMsMax: 30,
      chunkCharsMin: 5,
      chunkCharsMax: 5,
      failureProbability: 0,
      includeDiagnostics: false,
    });
    appState.updateHttpConnectionSettings({ enabled: false });
    appState.setProviderApiKey("http", "");
    registerProviders();
    chatStore.setDefaultChatProviderResolver(() => "debug-workspace");
    chatStore.setActiveWorkspaceRoot("/work/a");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes Debug access preflight when Debug is enabled", async () => {
    chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" });

    const result = await chatStore.runAccessPreflight();

    expect(result.status).toBe("ready");
    expect(result.message).toContain("Debug Agent provider is ready");
  });

  it("passes Debug access preflight for draft agents without thread metadata when Debug is the default provider", async () => {
    chatStore.setDefaultChatProviderResolver(() => "debug-workspace");
    chatStore.createDraftSession();

    const result = await chatStore.runAccessPreflight();

    expect(result.status).toBe("ready");
    expect(chatStore.getActiveChatProvider()).toBe("debug-workspace");
  });

  it("blocks HTTP access preflight when credentials are missing", async () => {
    chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const result = await chatStore.runAccessPreflight();

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(WorkspaceAccessReason.MissingProviderConfig);
  });

  it("passes HTTP access preflight when credentials are configured", async () => {
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    registerProviders(true);
    chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const result = await chatStore.runAccessPreflight();

    expect(result.status).toBe("ready");
    expect(result.message).toContain("HTTP");
  });

  it("blocks send when Debug provider is disabled", async () => {
    const agentId = chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentId!);
    appState.updateDebugWorkspaceProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debugWorkspace,
      enabled: false,
    });

    const result = await sendChatMessage("Should not send", agentId!);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("debug_disabled");
      expect(result.message).toBe(DEBUG_AGENT_PROVIDER_DISABLED_MESSAGE);
    }
    expect(chatStore.getMessages(agentId!)).toHaveLength(0);
  });

  it("blocks send when HTTP is selected but not configured", async () => {
    const agentId = chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" }, undefined, agentId!);

    const result = await sendChatMessage("Should not send", agentId!);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("http_not_configured");
      expect(result.message).toBe(HTTP_MISSING_CONFIG_MESSAGE);
    }
    expect(chatStore.getMessages(agentId!)).toHaveLength(0);
  });

  it("allows Debug and HTTP agents to generate concurrently", async () => {
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    registerProviders(true);

    const debugAgent = chatStore.createDraftSession({ activate: false });
    const httpAgent = chatStore.createDraftSession({ activate: true });
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, debugAgent!);
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" }, undefined, httpAgent!);

    const debugSend = sendChatMessage("Debug parallel question", debugAgent!);
    const httpSend = sendChatMessage("HTTP parallel question", httpAgent!);

    expect(chatStore.getRuntimeState(debugAgent!).isGenerating).toBe(true);
    expect(chatStore.getRuntimeState(httpAgent!).isGenerating).toBe(true);

    await vi.runAllTimersAsync();
    const [debugResult, httpResult] = await Promise.all([debugSend, httpSend]);

    expect(debugResult.ok).toBe(true);
    expect(httpResult.ok).toBe(true);
    expect(chatStore.getRuntimeState(debugAgent!).isGenerating).toBe(false);
    expect(chatStore.getRuntimeState(httpAgent!).isGenerating).toBe(false);
    expect(chatStore.getMessages(debugAgent!).some((message) => message.role === "assistant")).toBe(true);
    expect(chatStore.getMessages(httpAgent!).some((message) => message.role === "assistant")).toBe(true);
  });

  it("locks generation per agent while allowing other agents to send", async () => {
    const agentA = chatStore.createDraftSession({ activate: false });
    const agentB = chatStore.createDraftSession({ activate: true });
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentA!);
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentB!);

    const firstOnA = sendChatMessage("First on A", agentA!);
    const duplicateOnA = await sendChatMessage("Duplicate on A", agentA!);
    const sendOnB = sendChatMessage("Send on B", agentB!);

    expect(duplicateOnA).toEqual({
      ok: false,
      reason: "generating",
      message: "Another response is already in progress.",
    });
    expect(chatStore.getRuntimeState(agentB!).isGenerating).toBe(true);

    await vi.runAllTimersAsync();
    await Promise.all([firstOnA, sendOnB]);

    expect(chatStore.getMessages(agentA!).filter((message) => message.role === "user")).toHaveLength(1);
    expect(chatStore.getMessages(agentB!).some((message) => message.role === "assistant")).toBe(true);
  });

  it("streams Debug partial updates then finalizes generation state", async () => {
    const agentId = chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentId!);

    const observedLengths: number[] = [];
    const unsubscribe = chatStore.subscribe(() => {
      const assistant = chatStore.getMessages(agentId!).find((message) => message.role === "assistant");
      if (assistant) {
        observedLengths.push(assistant.content.length);
      }
    });

    const resultPromise = sendChatMessage("Stream in agent tab", agentId!);
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    unsubscribe();

    expect(result.ok).toBe(true);
    expect(observedLengths.length).toBeGreaterThan(1);
    expect(new Set(observedLengths).size).toBeGreaterThan(1);
    expect(chatStore.getRuntimeState(agentId!).isGenerating).toBe(false);
  });

  it("records Debug failure in retry scaffolding", async () => {
    const agentId = chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentId!);
    appState.updateDebugWorkspaceProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debugWorkspace,
      failureProbability: 1,
      failureMessage: "Simulated provider failure",
    });

    const resultPromise = sendChatMessage("This should fail", agentId!);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(chatStore.getRuntimeState(agentId!)).toMatchObject({
      isGenerating: false,
      lastFailedTurnId: expect.stringMatching(/^turn-/),
      lastError: { message: "Simulated provider failure", code: "provider_error" },
    });
    expect(chatStore.canRetryLastTurn(agentId!)).toBe(true);
  });

  it("runs HTTP ask and review modes through the send pipeline", async () => {
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    resetChatProviderRegistryForTests();
    registerTestDebugWorkspaceProvider();
    registerChatProvider(
      createOpenAiCompatibleChatProvider(
        () => ({
          settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
          apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
        }),
        httpFetchSuccess("## Summary\nReview output from HTTP."),
      ),
    );

    const agentId = chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "http", mode: "review" }, undefined, agentId!);

    const result = await sendChatMessage("Review this spec", agentId!);

    expect(result.ok).toBe(true);
    expect(chatStore.getMessages(agentId!).at(-1)?.content).toContain("## Summary");
    expect(schedulePersistMock).toHaveBeenCalledTimes(3);
  });

  it("persists provider switch system event in agent thread", async () => {
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    registerProviders(true);

    const agentId = chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" }, undefined, agentId!);
    chatStore.appendMessage(
      {
        id: "m-1",
        role: "user",
        content: "hello",
        createdAt: "2026-05-28T12:00:00.000Z",
      },
      { sessionId: agentId! },
    );

    const switchResult = await chatStore.switchThreadProvider("debug-workspace",
      {
        providerSettings: appState.getSnapshot().settings.providerSettings,
        providerModelCatalogs: defaultProviderModelCatalogs,
      },
      agentId!,
    );

    expect(switchResult.switched).toBe(true);
    expect(chatStore.getMetadata(agentId!)?.provider).toBe("debug-workspace");
    expect(chatStore.getMessages(agentId!).at(-1)).toMatchObject({
      role: "system",
      content: "Provider switched from HTTP to Debug Provider.",
      systemEvent: {
        type: "provider-switched",
        fromProvider: "http",
        toProvider: "debug-workspace",
      },
    });

    const thread = chatStore.getActiveThreadSnapshot(agentId!);
    scheduleSessionThreadFilePersistence("/work/a", agentId!, { version: 1, thread: thread! });
    const persistedSnapshot = schedulePersistMock.mock.calls.at(-1)?.[2];
    expect(
      persistedSnapshot?.thread.messages.some(
        (message) => message.systemEvent?.type === "provider-switched",
      ),
    ).toBe(true);
  });

  it("blocks send when workspace access preflight fails", async () => {
    ensureWorkspaceReadAccessMock.mockResolvedValue("blocked");
    appState.addWorkspace("/work/a");
    const agentId = chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentId!);

    const result = await sendChatMessage("Should be blocked", agentId!);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("preflight");
    }
    expect(chatStore.getMessages(agentId!)).toHaveLength(0);
    expect(chatStore.getRuntimeState(agentId!).isGenerating).toBe(false);
  });
});
