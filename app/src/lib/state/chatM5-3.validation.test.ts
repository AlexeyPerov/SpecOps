/**
 * M5.3 milestone validation — automated exit-criteria checks for GLM in agent tabs.
 *
 * Manual smoke (workspace UI; not covered here):
 * - Enable Debug in Developer Settings; ask + review in agent tab with streaming visible
 * - Two agents: one Debug, one GLM generating concurrently (when GLM configured)
 * - Toggle Debug failure probability; confirm inline error + retry scaffolding state
 * - Disable Debug with agent on Debug provider; confirm send blocked with hint
 * - GLM ask + review when credentials configured in Settings → GLM
 * - Provider switch event persists in agent thread after restart
 *
 * Optional manual GLM integration smoke (requires network + credentials):
 * - Enter API key in Settings → GLM (stored in glm-secrets.json, never in settings.json or thread files)
 * - Defaults: base URL https://open.bigmodel.cn/api/paas/v4, model glm-4-flash
 * - Send ask and review messages; verify assistant replies persist after app restart
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessReason } from "../ai/capabilities";
import { DEBUG_PROVIDER_DISABLED_MESSAGE, GLM_MISSING_CONFIG_MESSAGE } from "../ai/chatErrorCopy";
import { sendChatMessage } from "../ai/sendChatMessage";
import { createDebugChatProvider } from "../ai/providers/debugChatProvider";
import { defaultDebugProviderSettings } from "../ai/providers/debugProviderSettings";
import { defaultProviderModelCatalogs } from "../ai/providers/providerModelCatalog";
import { createGlmChatProvider } from "../ai/providers/glmChatProvider";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "../ai/providers/registry";
import { createRegistryCapabilityChecker } from "../ai/providers/capabilityChecker";
import { resetChatProvidersForTests } from "../ai/providers/bootstrap";
import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";
import { appState } from "./appState";
import { chatStore } from "./chatStore";

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

function glmFetchSuccess(content: string): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ) as typeof fetch;
}

function registerProviders(includeGlm = false): void {
  resetChatProviderRegistryForTests();
  registerChatProvider(createDebugChatProvider(() => appState.getSnapshot().settings.providerSettings.debug));
  if (includeGlm) {
    registerChatProvider(
      createGlmChatProvider(
        () => ({
          settings: appState.getSnapshot().settings.providerSettings.glm,
          apiKey: appState.getSnapshot().settings.glmApiKey,
        }),
        glmFetchSuccess("GLM buffered response."),
      ),
    );
  }
  chatStore.setCapabilityChecker(
    createRegistryCapabilityChecker(
      () => appState.getSnapshot().settings.providerSettings.debug,
      () => ({
        settings: appState.getSnapshot().settings.providerSettings.glm,
        apiKey: appState.getSnapshot().settings.glmApiKey,
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
    appState.updateDebugProviderSettings({
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
    appState.setGlmApiKey("");
    registerProviders();
    chatStore.setDefaultChatProviderResolver(() => "debug");
    chatStore.setActiveWorkspaceRoot("/work/a");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes Debug access preflight when Debug is enabled", async () => {
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" });

    const result = await chatStore.runAccessPreflight();

    expect(result.status).toBe("ready");
    expect(result.message).toContain("Debug provider is ready");
  });

  it("passes Debug access preflight for draft agents without thread metadata when Debug is the default provider", async () => {
    chatStore.setDefaultChatProviderResolver(() => "debug");
    chatStore.createDraftAgent();

    const result = await chatStore.runAccessPreflight();

    expect(result.status).toBe("ready");
    expect(chatStore.getActiveChatProvider()).toBe("debug");
  });

  it("blocks GLM access preflight when credentials are missing", async () => {
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "glm", mode: "ask" });

    const result = await chatStore.runAccessPreflight();

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(WorkspaceAccessReason.MissingProviderConfig);
  });

  it("passes GLM access preflight when credentials are configured", async () => {
    appState.setGlmApiKey("glm-test-key");
    registerProviders(true);
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "glm", mode: "ask" });

    const result = await chatStore.runAccessPreflight();

    expect(result.status).toBe("ready");
    expect(result.message).toContain("GLM");
  });

  it("blocks send when Debug provider is disabled", async () => {
    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" }, undefined, agentId!);
    appState.updateDebugProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debug,
      enabled: false,
    });

    const result = await sendChatMessage("Should not send", agentId!);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("debug_disabled");
      expect(result.message).toBe(DEBUG_PROVIDER_DISABLED_MESSAGE);
    }
    expect(chatStore.getMessages(agentId!)).toHaveLength(0);
  });

  it("blocks send when GLM is selected but not configured", async () => {
    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "glm", mode: "ask" }, undefined, agentId!);

    const result = await sendChatMessage("Should not send", agentId!);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("glm_not_configured");
      expect(result.message).toBe(GLM_MISSING_CONFIG_MESSAGE);
    }
    expect(chatStore.getMessages(agentId!)).toHaveLength(0);
  });

  it("allows Debug and GLM agents to generate concurrently", async () => {
    appState.setGlmApiKey("glm-test-key");
    registerProviders(true);

    const debugAgent = chatStore.createDraftAgent({ activate: false });
    const glmAgent = chatStore.createDraftAgent({ activate: true });
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" }, undefined, debugAgent!);
    chatStore.updateThreadMetadata({ provider: "glm", mode: "ask" }, undefined, glmAgent!);

    const debugSend = sendChatMessage("Debug parallel question", debugAgent!);
    const glmSend = sendChatMessage("GLM parallel question", glmAgent!);

    expect(chatStore.getRuntimeState(debugAgent!).isGenerating).toBe(true);
    expect(chatStore.getRuntimeState(glmAgent!).isGenerating).toBe(true);

    await vi.runAllTimersAsync();
    const [debugResult, glmResult] = await Promise.all([debugSend, glmSend]);

    expect(debugResult.ok).toBe(true);
    expect(glmResult.ok).toBe(true);
    expect(chatStore.getRuntimeState(debugAgent!).isGenerating).toBe(false);
    expect(chatStore.getRuntimeState(glmAgent!).isGenerating).toBe(false);
    expect(chatStore.getMessages(debugAgent!).some((message) => message.role === "assistant")).toBe(true);
    expect(chatStore.getMessages(glmAgent!).some((message) => message.role === "assistant")).toBe(true);
  });

  it("locks generation per agent while allowing other agents to send", async () => {
    const agentA = chatStore.createDraftAgent({ activate: false });
    const agentB = chatStore.createDraftAgent({ activate: true });
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" }, undefined, agentA!);
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" }, undefined, agentB!);

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
    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" }, undefined, agentId!);

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
    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" }, undefined, agentId!);
    appState.updateDebugProviderSettings({
      ...appState.getSnapshot().settings.providerSettings.debug,
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

  it("runs GLM ask and review modes through the send pipeline", async () => {
    appState.setGlmApiKey("glm-test-key");
    resetChatProviderRegistryForTests();
    registerChatProvider(createDebugChatProvider(() => appState.getSnapshot().settings.providerSettings.debug));
    registerChatProvider(
      createGlmChatProvider(
        () => ({
          settings: appState.getSnapshot().settings.providerSettings.glm,
          apiKey: appState.getSnapshot().settings.glmApiKey,
        }),
        glmFetchSuccess("## Summary\nReview output from GLM."),
      ),
    );

    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "glm", mode: "review" }, undefined, agentId!);

    const result = await sendChatMessage("Review this spec", agentId!);

    expect(result.ok).toBe(true);
    expect(chatStore.getMessages(agentId!).at(-1)?.content).toContain("## Summary");
    expect(schedulePersistMock).toHaveBeenCalledOnce();
  });

  it("persists provider switch system event in agent thread", async () => {
    appState.setGlmApiKey("glm-test-key");
    registerProviders(true);

    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "glm", mode: "ask" }, undefined, agentId!);
    chatStore.appendMessage(
      {
        id: "m-1",
        role: "user",
        content: "hello",
        createdAt: "2026-05-28T12:00:00.000Z",
      },
      { agentId: agentId! },
    );

    const switchResult = await chatStore.switchThreadProvider(
      "debug",
      {
        debugProviderEnabled: true,
        providerModelCatalogs: defaultProviderModelCatalogs,
      },
      agentId!,
    );

    expect(switchResult.switched).toBe(true);
    expect(chatStore.getMetadata(agentId!)?.provider).toBe("debug");
    expect(chatStore.getMessages(agentId!).at(-1)).toMatchObject({
      role: "system",
      content: "Provider switched from GLM to Debug.",
      systemEvent: {
        type: "provider-switched",
        fromProvider: "glm",
        toProvider: "debug",
      },
    });

    const thread = chatStore.getActiveThreadSnapshot(agentId!);
    scheduleAgentThreadFilePersistence("/work/a", agentId!, { version: 1, thread: thread! });
    const persistedSnapshot = schedulePersistMock.mock.calls.at(-1)?.[2];
    expect(
      persistedSnapshot?.thread.messages.some(
        (message) => message.systemEvent?.type === "provider-switched",
      ),
    ).toBe(true);
  });

  it("blocks send when workspace access preflight fails", async () => {
    ensureWorkspaceReadAccessMock.mockResolvedValue("blocked");
    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" }, undefined, agentId!);

    const result = await sendChatMessage("Should be blocked", agentId!);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("preflight");
    }
    expect(chatStore.getMessages(agentId!)).toHaveLength(0);
    expect(chatStore.getRuntimeState(agentId!).isGenerating).toBe(false);
  });
});
