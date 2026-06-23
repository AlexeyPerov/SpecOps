/**
 * M6 milestone validation — AI chat MVP ship gate.
 *
 * Manual smoke (workspace UI; not covered here):
 * - Workspace → agents sidebar visible; notepad → sidebar hidden
 * - New agent draft → first message persists thread and updates title
 * - Send ask and review prompts via HTTP in agent tab (Debug when enabled)
 * - Simulate HTTP misconfig → setup CTA → recovery
 * - Simulate workspace access loss → blocked chat → recovery
 * - Exceed retention cap → compaction banner + summary preserved
 * - Delete agent removes thread and sidebar entry
 * - Trigger failed response → Retry succeeds
 * - Verify streaming on Debug and HTTP
 * - Two agent tabs generating simultaneously without blocking each other
 * - Notepad context keeps no chat/AI entry points (manual UI regression check)
 *
 * Optional manual HTTP integration smoke (requires network + credentials):
 * - Enter API key in Settings → Dev → Providers (Chat beta, stored in provider-secrets.json)
 * - Defaults: base URL https://open.bigmodel.cn/api/paas/v4, model gpt-4o-mini
 * - Send ask and review messages; verify assistant replies persist after restart
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessReason } from "../ai/capabilities";
import {
  DEBUG_PROVIDER_DISABLED_RECOVERY,
  HTTP_MISSING_CONFIG_RECOVERY,
  PROVIDER_MISSING_CONFIG_RECOVERY,
  PROVIDER_REQUEST_FAILURE_RECOVERY,
  WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
  getAccessBlockedCopy,
  getDebugProviderDisabledCopy,
  getHttpMissingConfigCopy,
} from "../ai/chatErrorCopy";
import { retryLastChatTurn, sendChatMessage } from "../ai/sendChatMessage";
import { registerTestDebugWorkspaceProvider, createTestCapabilityChecker } from "../ai/providers/debugProviderTestHelpers";
import { defaultDebugProviderSettings } from "../ai/providers/debugProviderSettings";
import { createOpenAiCompatibleChatProvider } from "../ai/providers/openAiCompatibleChatProvider";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "../ai/providers/registry";
import { createRegistryCapabilityChecker } from "../ai/providers/capabilityChecker";
import { resetChatProvidersForTests } from "../ai/providers/bootstrap";
import { deleteAgentPersistence, scheduleAgentThreadFilePersistence } from "../services/chatPersistence";
import { setChatRetentionMaxTurnsForTests } from "../services/chatRetention";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";
import { appState } from "./appState";
import { chatStore } from "./chatStore";

vi.mock("../services/chatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/chatPersistence")>();
  return {
    ...actual,
    scheduleAgentThreadFilePersistence: vi.fn(),
    deleteAgentPersistence: vi.fn(),
  };
});

vi.mock("../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
}));

const deleteAgentPersistenceMock = vi.mocked(deleteAgentPersistence);
const schedulePersistMock = vi.mocked(scheduleAgentThreadFilePersistence);
const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);

function httpFetchSuccess(content: string): typeof fetch {
  const splitAt = Math.ceil(content.length / 2);
  const chunks = [content.slice(0, splitAt), content.slice(splitAt)].filter(Boolean);
  return vi.fn().mockResolvedValue(
    new Response(
      `${chunks.map((chunk) => `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`).join("")}data: [DONE]\n\n`,
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      },
    ),
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

describe("M6 milestone validation — AI chat MVP", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chatStore.reset();
    resetChatProvidersForTests();
    deleteAgentPersistenceMock.mockReset();
    deleteAgentPersistenceMock.mockResolvedValue(undefined);
    schedulePersistMock.mockReset();
    ensureWorkspaceReadAccessMock.mockReset();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    setChatRetentionMaxTurnsForTests(undefined);
    appState.setProviderApiKey("http", "");
    appState.updateDebugWorkspaceProviderSettings({
      ...defaultDebugProviderSettings,
      enabled: true,
      simulationSeed: 42,
      delayMsMin: 40,
      delayMsMax: 40,
      chunkCharsMin: 4,
      chunkCharsMax: 4,
      failureProbability: 0,
      includeDiagnostics: false,
    });
    appState.updateHttpConnectionSettings({ enabled: false });
    registerProviders();
    chatStore.setDefaultChatProviderResolver(() => "debug-workspace");
    chatStore.setActiveWorkspaceRoot("/work/a");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries failed Debug turns without duplicating the user message", async () => {
    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentId!);
    appState.updateDebugWorkspaceProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debugWorkspace,
      failureProbability: 1,
      failureMessage: "Simulated provider failure",
    });

    const failedPromise = sendChatMessage("Retry me", agentId!);
    await vi.runAllTimersAsync();
    const failed = await failedPromise;

    expect(failed.ok).toBe(false);
    expect(chatStore.getMessages(agentId!).filter((message) => message.role === "user")).toHaveLength(1);
    expect(chatStore.canRetryLastTurn(agentId!)).toBe(true);

    appState.updateDebugWorkspaceProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debugWorkspace,
      failureProbability: 0,
    });

    const retryPromise = retryLastChatTurn(agentId!);
    await vi.runAllTimersAsync();
    const retried = await retryPromise;

    expect(retried.ok).toBe(true);
    expect(chatStore.getMessages(agentId!).filter((message) => message.role === "user")).toHaveLength(1);
    expect(chatStore.getMessages(agentId!).some((message) => message.role === "assistant")).toBe(true);
    expect(chatStore.canRetryLastTurn(agentId!)).toBe(false);
  });

  it("retries failed HTTP turns without duplicating the user message", async () => {
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
    resetChatProviderRegistryForTests();
    registerTestDebugWorkspaceProvider();
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

    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" }, undefined, agentId!);

    const failed = await sendChatMessage("Retry HTTP", agentId!);
    expect(failed.ok).toBe(false);
    expect(chatStore.getMessages(agentId!).filter((message) => message.role === "user")).toHaveLength(1);

    const retried = await retryLastChatTurn(agentId!);
    expect(retried.ok).toBe(true);
    expect(chatStore.getMessages(agentId!).filter((message) => message.role === "user")).toHaveLength(1);
    expect(chatStore.getMessages(agentId!).find((message) => message.role === "assistant")?.content).toBe(
      "Retried HTTP response.",
    );
  });

  it("streams Debug and HTTP partial updates", async () => {
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    registerProviders(true);

    const debugAgent = chatStore.createDraftAgent({ activate: false });
    const httpAgent = chatStore.createDraftAgent({ activate: true });
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, debugAgent!);
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" }, undefined, httpAgent!);

    const debugLengths: number[] = [];
    const httpLengths: number[] = [];
    const unsubscribe = chatStore.subscribe(() => {
      const debugAssistant = chatStore.getMessages(debugAgent!).find((message) => message.role === "assistant");
      const httpAssistant = chatStore.getMessages(httpAgent!).find((message) => message.role === "assistant");
      if (debugAssistant) {
        debugLengths.push(debugAssistant.content.length);
      }
      if (httpAssistant) {
        httpLengths.push(httpAssistant.content.length);
      }
    });

    const debugSend = sendChatMessage("Stream please", debugAgent!);
    const httpSend = sendChatMessage("Buffer please", httpAgent!);
    await vi.runAllTimersAsync();
    await Promise.all([debugSend, httpSend]);
    unsubscribe();

    expect(new Set(debugLengths).size).toBeGreaterThan(1);
    expect(new Set(httpLengths).size).toBeGreaterThan(1);
    expect(httpLengths).toContain("HTTP buffere".length);
    expect(httpLengths.at(-1)).toBe("HTTP buffered response.".length);
  });

  it("blocks retry while generation is in progress", async () => {
    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentId!);
    appState.updateDebugWorkspaceProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debugWorkspace,
      failureProbability: 1,
      failureMessage: "Simulated provider failure",
    });

    const failedPromise = sendChatMessage("Will fail", agentId!);
    await vi.runAllTimersAsync();
    await failedPromise;

    appState.updateDebugWorkspaceProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debugWorkspace,
      failureProbability: 0,
    });

    const retryPromise = retryLastChatTurn(agentId!);
    await Promise.resolve();
    const blockedRetry = await retryLastChatTurn(agentId!);
    await vi.runAllTimersAsync();
    await retryPromise;

    expect(blockedRetry).toEqual({
      ok: false,
      reason: "no_failed_turn",
      message: "There is no failed response to retry.",
    });
  });

  it("exposes recovery hints for major blocked and failure paths", () => {
    expect(getHttpMissingConfigCopy().recoveryHint).toBe(HTTP_MISSING_CONFIG_RECOVERY);
    expect(getDebugProviderDisabledCopy().recoveryHint).toBe(DEBUG_PROVIDER_DISABLED_RECOVERY);
    expect(
      getAccessBlockedCopy(WorkspaceAccessReason.WorkspacePathInaccessible).recoveryHint,
    ).toBe(WORKSPACE_PATH_INACCESSIBLE_RECOVERY);
    expect(
      getAccessBlockedCopy(WorkspaceAccessReason.MissingProviderConfig, { activeProvider: "http" }).recoveryHint,
    ).toBe(PROVIDER_MISSING_CONFIG_RECOVERY);
    expect(PROVIDER_REQUEST_FAILURE_RECOVERY).toContain("Retry");
  });

  it("preserves compaction metadata and delete agent clears the thread", async () => {
    setChatRetentionMaxTurnsForTests(1);
    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentId!);

    chatStore.appendMessage(
      {
        id: "u-1",
        role: "user",
        content: "first question",
        createdAt: "2026-05-26T00:00:01.000Z",
      },
      { agentId: agentId! },
    );
    chatStore.appendMessage(
      {
        id: "a-1",
        role: "assistant",
        content: "first answer",
        createdAt: "2026-05-26T00:00:02.000Z",
      },
      { agentId: agentId! },
    );
    chatStore.appendMessage(
      {
        id: "u-2",
        role: "user",
        content: "second question",
        createdAt: "2026-05-26T00:00:03.000Z",
      },
      { agentId: agentId! },
    );

    const metadata = chatStore.getMetadata(agentId!);
    expect(metadata?.summary).toContain("- User: first question");
    expect(metadata?.compactedMessageCount).toBeGreaterThan(0);
    expect(metadata?.lastCompactedAt).toBeDefined();

    await chatStore.deleteAgent(agentId!);

    const workspace = chatStore.getWorkspaceAgentsState("/work/a");
    expect(workspace?.threadsByAgentId[agentId!]).toBeUndefined();
    expect(workspace?.agentIndex.some((entry) => entry.id === agentId)).toBe(false);
    expect(deleteAgentPersistenceMock).toHaveBeenCalledWith("/work/a", agentId);
  });

  it("allows two agents to generate concurrently without blocking each other", async () => {
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    registerProviders(true);

    const debugAgent = chatStore.createDraftAgent({ activate: false });
    const httpAgent = chatStore.createDraftAgent({ activate: true });
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, debugAgent!);
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" }, undefined, httpAgent!);

    const debugSend = sendChatMessage("Debug parallel", debugAgent!);
    const httpSend = sendChatMessage("HTTP parallel", httpAgent!);

    expect(chatStore.getRuntimeState(debugAgent!).isGenerating).toBe(true);
    expect(chatStore.getRuntimeState(httpAgent!).isGenerating).toBe(true);

    await vi.runAllTimersAsync();
    const [debugResult, httpResult] = await Promise.all([debugSend, httpSend]);

    expect(debugResult.ok).toBe(true);
    expect(httpResult.ok).toBe(true);
    expect(chatStore.getRuntimeState(debugAgent!).isGenerating).toBe(false);
    expect(chatStore.getRuntimeState(httpAgent!).isGenerating).toBe(false);
  });
});
