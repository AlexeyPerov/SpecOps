/**
 * Phase 3 Milestone 3 validation — workspace HTTP cutover regression gate.
 *
 * Automated invariants covered here:
 * - Workspace sends route exclusively through OpenCode backend (never HTTP ChatProvider)
 * - Chat-http sends never invoke workspace backend
 * - shouldUseWorkspaceAgentBackend routing invariants hold for all context kinds
 * - Event normalization aligns with contract freeze (v2 names, session-scoped)
 * - Session restore reconciliation clears stale OpenCode mappings
 * - Permission/question/tool flows work end-to-end via workspace backend
 * - Chat-http non-regression: streaming, cancellation, retry all unaffected
 *
 * Manual smoke (not covered here):
 * - Open workspace folder → agent turn runs via OpenCode with tools on disk
 * - Permission prompt blocks and resolves in UI
 * - Question prompt blocks and resolves in UI
 * - Sidecar mode: `opencode serve` auto-started, health indicator green
 * - URL mode: configure server URL in Settings, send a prompt
 * - Chat context still works end-to-end with HTTP provider
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import { chatStore } from "./chatStore";
import { appState } from "./appState";
import {
  shouldUseWorkspaceAgentBackend,
  resolveChatContextKind,
  type ChatContextKind,
} from "../ai/chatSendPipeline";
import { sendChatMessage, retryLastChatTurn } from "../ai/sendChatMessage";
import { defaultDebugProviderSettings } from "../ai/providers/debugProviderSettings";
import {
  registerBothTestDebugProviders,
} from "../ai/providers/debugProviderTestHelpers";
import { createOpenAiCompatibleChatProvider } from "../ai/providers/openAiCompatibleChatProvider";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "../ai/providers/registry";
import { createRegistryCapabilityChecker } from "../ai/providers/capabilityChecker";
import { resetChatProvidersForTests } from "../ai/providers/bootstrap";
import { scheduleSessionThreadFilePersistence } from "../services/chatPersistence";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";
import { createWorkspaceAgentBackend } from "../ai/backends/workspaceAgentBackend";
import { promptPermission } from "../services/permissionPrompt";
import { promptQuestion } from "../services/questionPrompt";
import {
  WorkspaceAgentBackendError,
  type WorkspaceAgentStreamEvent,
} from "../ai/backends/workspaceAgentBackend";
import { createRawOpencodeClientStub } from "../test/rawOpencodeClientStub";
import {
  mappedSessionForId,
  isSessionMappingValid,
  reconcileSessionMapping,
  type SessionMapping,
} from "../services/workspaceAgentSession";

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

vi.mock("../ai/backends/workspaceAgentBackend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ai/backends/workspaceAgentBackend")>();
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

const schedulePersistMock = vi.mocked(scheduleSessionThreadFilePersistence);
const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);
const createWorkspaceAgentBackendMock = vi.mocked(createWorkspaceAgentBackend);
const promptPermissionMock = vi.mocked(promptPermission);
const promptQuestionMock = vi.mocked(promptQuestion);

function makeSseResponse(events: string[]): Response {
  return new Response(events.join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function setupWorkspaceBackend(
  streamEvents: () => AsyncIterable<WorkspaceAgentStreamEvent>,
  overrides?: {
    replyPermission?: ReturnType<typeof vi.fn>;
    replyQuestion?: ReturnType<typeof vi.fn>;
    rejectQuestion?: ReturnType<typeof vi.fn>;
  },
) {
  createWorkspaceAgentBackendMock.mockReturnValue({
    id: "opencode",
    createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
    getSession: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn(),
    deleteSession: vi.fn(),
    send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
    replyPermission: overrides?.replyPermission ?? vi.fn().mockResolvedValue(undefined),
    replyQuestion: overrides?.replyQuestion ?? vi.fn().mockResolvedValue(undefined),
    rejectQuestion: overrides?.rejectQuestion ?? vi.fn().mockResolvedValue(undefined),
    abortSession: vi.fn().mockResolvedValue(undefined),
    streamEvents: vi.fn().mockImplementation(streamEvents),
  } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
}

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

describe("Phase 3 M3 validation — workspace HTTP cutover regression gate", () => {
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
    appState.setChatHttpEnabled(true);
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

  describe("Cutover invariant: workspace sends never use HTTP ChatProvider", () => {
    it("workspace send routes through OpenCode backend", async () => {
      appState.addWorkspace("/work/a");
      setupWorkspaceBackend(async function* () {
        yield { type: "message.delta", delta: "from OpenCode" };
        yield { type: "run.completed" };
      });

      const result = await sendChatMessage("Workspace prompt");

      expect(result.ok).toBe(true);
      expect(createWorkspaceAgentBackendMock).toHaveBeenCalledWith("opencode", expect.any(Object));
      expect(
        chatStore.getMessages().find((m) => m.role === "assistant")?.content,
      ).toBe("from OpenCode");
    });

    it("workspace send succeeds when HTTP provider is completely unconfigured", async () => {
      ensureWorkspaceContext("/work/a");
      appState.updateHttpConnectionSettings({ enabled: false });
      appState.setProviderApiKey("http", "");
      setupWorkspaceBackend(async function* () {
        yield { type: "message.delta", delta: "OpenCode only" };
        yield { type: "run.completed" };
      });

      const result = await sendChatMessage("No HTTP needed");

      expect(result.ok).toBe(true);
      expect(
        chatStore.getMessages().find((m) => m.role === "assistant")?.content,
      ).toBe("OpenCode only");
    });

    it("workspace send does not call HTTP provider fetch", async () => {
      ensureWorkspaceContext("/work/a");
      resetChatProviderRegistryForTests();
      appState.updateHttpConnectionSettings({ enabled: true });
      appState.setProviderApiKey("http", "http-test-key");
      const httpFetch = vi.fn().mockResolvedValue(makeSseResponse(["data: [DONE]\n\n"]));
      registerChatProvider(
        createOpenAiCompatibleChatProvider(
          () => ({
            settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
            apiKey: "http-test-key",
          }),
          httpFetch as typeof fetch,
        ),
      );
      chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });
      setupWorkspaceBackend(async function* () {
        yield { type: "message.delta", delta: "backend" };
        yield { type: "run.completed" };
      });

      const result = await sendChatMessage("No HTTP fetch");

      expect(result.ok).toBe(true);
      expect(httpFetch).not.toHaveBeenCalled();
    });
  });

  describe("Cutover invariant: chat-http sends never use workspace backend", () => {
    it("chat-http send uses HTTP provider, not workspace backend", async () => {
      appState.switchContext("chat-http");
      chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
      chatStore.createDraftSession();
      chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" });

      const resultPromise = sendChatMessage("Chat-http message", undefined, {
        chatContextKind: "chat-http",
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(createWorkspaceAgentBackendMock).not.toHaveBeenCalled();
    });

    it("chat-http send skips workspace access preflight", async () => {
      chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
      chatStore.createDraftSession();
      chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" });
      ensureWorkspaceReadAccessMock.mockResolvedValue("blocked");

      const resultPromise = sendChatMessage("Chat-http ignores preflight", undefined, {
        chatContextKind: "chat-http",
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(ensureWorkspaceReadAccessMock).not.toHaveBeenCalled();
    });

    it("chat-http SSE streaming produces correct final content", async () => {
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
              `data: ${JSON.stringify({ choices: [{ delta: { content: "Chunk1 " } }] })}\n\n`,
              `data: ${JSON.stringify({ choices: [{ delta: { content: "Chunk2" } }] })}\n\n`,
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

      const result = await sendChatMessage("HTTP stream");

      expect(result.ok).toBe(true);
      expect(
        chatStore.getMessages().find((m) => m.role === "assistant")?.content,
      ).toBe("Chunk1 Chunk2");
    });

    it("chat-http cancellation aborts the SSE stream", async () => {
      resetChatProviderRegistryForTests();
      appState.updateHttpConnectionSettings({ enabled: true });
      appState.setProviderApiKey("http", "http-test-key");
      const abortSignals: AbortSignal[] = [];
      const sseFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) abortSignals.push(signal);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`,
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
      const agentId = chatStore.getActiveSessionId();
      chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

      const sendPromise = sendChatMessage("Cancel HTTP");
      await Promise.resolve();
      expect(chatStore.getRuntimeState().isGenerating).toBe(true);
      chatStore.cancelSessionGeneration("/work/a", agentId!);
      const result = await sendPromise;

      expect(result.ok).toBe(false);
      expect(abortSignals).toHaveLength(1);
      expect(abortSignals[0]?.aborted).toBe(true);
    });

    it("chat-http retry succeeds after HTTP provider failure", async () => {
      resetChatProviderRegistryForTests();
      appState.updateHttpConnectionSettings({ enabled: true });
      appState.setProviderApiKey("http", "http-test-key");
      const httpFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { message: "Bad key" } }), { status: 401 }),
        )
        .mockResolvedValueOnce(
          makeSseResponse([
            `data: ${JSON.stringify({ choices: [{ delta: { content: "Retried ok" } }] })}\n\n`,
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

      const failed = await sendChatMessage("Retry HTTP");
      expect(failed.ok).toBe(false);
      expect(chatStore.canRetryLastTurn()).toBe(true);

      const retried = await retryLastChatTurn();
      expect(retried.ok).toBe(true);
      expect(
        chatStore.getMessages().find((m) => m.role === "assistant")?.content,
      ).toBe("Retried ok");
    });
  });

  describe("shouldUseWorkspaceAgentBackend routing invariants", () => {
    it("returns true for workspace context with ws-* active context", () => {
      appState.addWorkspace("/work/project");
      const result = shouldUseWorkspaceAgentBackend({
        root: "/work/project",
        chatContextKind: "workspace",
      });
      expect(result).toBe(true);
    });

    it("returns false for chat-http context kind", () => {
      const result = shouldUseWorkspaceAgentBackend({
        root: CHAT_HTTP_CONTEXT_ID,
        chatContextKind: "chat-http",
      });
      expect(result).toBe(false);
    });

    it("returns false when chatContextKind is workspace but root is chat-http", () => {
      const result = shouldUseWorkspaceAgentBackend({
        root: CHAT_HTTP_CONTEXT_ID,
        chatContextKind: "workspace",
      });
      expect(result).toBe(false);
    });

    it("returns false for non-workspace chatContextKind", () => {
      const result = shouldUseWorkspaceAgentBackend({
        root: "/work/a",
        chatContextKind: "chat-http",
      });
      expect(result).toBe(false);
    });
  });

  describe("resolveChatContextKind invariants", () => {
    it("resolves chat-http for chat-http scope key", () => {
      expect(
        resolveChatContextKind(CHAT_HTTP_CONTEXT_ID, { chatContextKind: undefined }),
      ).toBe("chat-http");
    });

    it("resolves workspace for non-chat-http scope keys", () => {
      expect(
        resolveChatContextKind("/work/a", { chatContextKind: undefined }),
      ).toBe("workspace");
    });

    it("uses explicit chatContextKind override over scope key", () => {
      expect(
        resolveChatContextKind(CHAT_HTTP_CONTEXT_ID, { chatContextKind: "chat-http" }),
      ).toBe("chat-http");
    });
  });

  describe("Event normalization contract alignment", () => {
    function noOpFactory() {
      return createRawOpencodeClientStub();
    }

    it("normalizes SDK text delta events to contract message.delta", async () => {
      const { createWorkspaceAgentBackend: realCreate } = await vi.importActual<
        typeof import("../ai/backends/workspaceAgentBackend")
      >("../ai/backends/workspaceAgentBackend");
      const client = noOpFactory();
      client.streamEvents = async function* () {
        yield { type: "session.next.text.delta", data: { delta: "Hello" } };
        yield { type: "session.status", data: { status: { type: "idle" } } };
      };
      const backend = realCreate("opencode", {
        resolveRuntimeConfig: async () => ({
          sidecarPort: 4096,
          mode: "url",
          baseUrl: "http://opencode.local",
        }),
        createOpencodeClient: () => client,
      });

      const events: WorkspaceAgentStreamEvent[] = [];
      for await (const event of backend.streamEvents({
        workspaceRootPath: "/tmp",
        sessionId: "s1",
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "message.delta", delta: "Hello" },
        { type: "run.completed" },
      ]);
    });

    it("normalizes SDK tool events to contract tool.started/tool.completed", async () => {
      const { createWorkspaceAgentBackend: realCreate } = await vi.importActual<
        typeof import("../ai/backends/workspaceAgentBackend")
      >("../ai/backends/workspaceAgentBackend");
      const client = noOpFactory();
      client.streamEvents = async function* () {
        yield {
          type: "session.next.tool.called",
          data: { tool: "bash", callID: "c1", input: "ls" },
        };
        yield {
          type: "session.next.tool.success",
          data: { tool: "bash", callID: "c1", result: "file.ts" },
        };
        yield { type: "session.status", data: { status: { type: "idle" } } };
      };
      const backend = realCreate("opencode", {
        resolveRuntimeConfig: async () => ({
          sidecarPort: 4096,
          mode: "url",
          baseUrl: "http://opencode.local",
        }),
        createOpencodeClient: () => client,
      });

      const events: WorkspaceAgentStreamEvent[] = [];
      for await (const event of backend.streamEvents({
        workspaceRootPath: "/tmp",
        sessionId: "s1",
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        {
          type: "tool.started",
          toolName: "bash",
          callId: "c1",
          input: "ls",
        },
        {
          type: "tool.completed",
          toolName: "bash",
          callId: "c1",
          output: "file.ts",
          isError: false,
        },
        { type: "run.completed" },
      ]);
    });

    it("normalizes SDK permission v2 event to contract permission.requested", async () => {
      const { createWorkspaceAgentBackend: realCreate } = await vi.importActual<
        typeof import("../ai/backends/workspaceAgentBackend")
      >("../ai/backends/workspaceAgentBackend");
      const client = noOpFactory();
      client.streamEvents = async function* () {
        yield {
          type: "permission.v2.asked",
          data: { id: "p1", action: "Run shell", path: "/tmp" },
        };
        yield { type: "session.status", data: { status: { type: "idle" } } };
      };
      const backend = realCreate("opencode", {
        resolveRuntimeConfig: async () => ({
          sidecarPort: 4096,
          mode: "url",
          baseUrl: "http://opencode.local",
        }),
        createOpencodeClient: () => client,
      });

      const events: WorkspaceAgentStreamEvent[] = [];
      for await (const event of backend.streamEvents({
        workspaceRootPath: "/tmp",
        sessionId: "s1",
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        {
          type: "permission.requested",
          permissionId: "p1",
          label: "Run shell",
          payload: { id: "p1", action: "Run shell", path: "/tmp" },
        },
        { type: "run.completed" },
      ]);
    });

    it("normalizes SDK question v2 event to contract question.requested", async () => {
      const { createWorkspaceAgentBackend: realCreate } = await vi.importActual<
        typeof import("../ai/backends/workspaceAgentBackend")
      >("../ai/backends/workspaceAgentBackend");
      const client = noOpFactory();
      client.streamEvents = async function* () {
        yield {
          type: "question.v2.asked",
          data: {
            id: "q1",
            questions: [{ header: "Pick one", options: [{ label: "A" }, { label: "B" }] }],
            step: 1,
          },
        };
        yield { type: "session.status", data: { status: { type: "idle" } } };
      };
      const backend = realCreate("opencode", {
        resolveRuntimeConfig: async () => ({
          sidecarPort: 4096,
          mode: "url",
          baseUrl: "http://opencode.local",
        }),
        createOpencodeClient: () => client,
      });

      const events: WorkspaceAgentStreamEvent[] = [];
      for await (const event of backend.streamEvents({
        workspaceRootPath: "/tmp",
        sessionId: "s1",
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        {
          type: "question.requested",
          questionId: "q1",
          prompt: "Pick one",
          choices: ["A", "B"],
          payload: {
            id: "q1",
            questions: [{ header: "Pick one", options: [{ label: "A" }, { label: "B" }] }],
            step: 1,
          },
        },
        { type: "run.completed" },
      ]);
    });

    it("normalizes session error to run.failed", async () => {
      const { createWorkspaceAgentBackend: realCreate } = await vi.importActual<
        typeof import("../ai/backends/workspaceAgentBackend")
      >("../ai/backends/workspaceAgentBackend");
      const client = noOpFactory();
      client.streamEvents = async function* () {
        yield { type: "session.error", data: { message: "crash" } };
      };
      const backend = realCreate("opencode", {
        resolveRuntimeConfig: async () => ({
          sidecarPort: 4096,
          mode: "url",
          baseUrl: "http://opencode.local",
        }),
        createOpencodeClient: () => client,
      });

      const events: WorkspaceAgentStreamEvent[] = [];
      for await (const event of backend.streamEvents({
        workspaceRootPath: "/tmp",
        sessionId: "s1",
      })) {
        events.push(event);
      }

      expect(events).toEqual([{ type: "run.failed", message: "crash" }]);
    });
  });

  describe("Session restore reconciliation post-cutover", () => {
    it("detects stale session mapping when session no longer exists on backend", () => {
      const mapping: SessionMapping = {
        sessionId: "agent-a",
        opencodeSessionId: "sess-stale",
        modelId: "gpt-4.1",
        providerId: "opencode",
      };
      const existingIds = new Set(["sess-live"]);

      expect(isSessionMappingValid(mapping, existingIds)).toBe(false);
    });

    it("valid session mapping when session exists on backend", () => {
      const mapping: SessionMapping = {
        sessionId: "agent-a",
        opencodeSessionId: "sess-live",
        modelId: "gpt-4.1",
        providerId: "opencode",
      };
      const existingIds = new Set(["sess-live"]);

      expect(isSessionMappingValid(mapping, existingIds)).toBe(true);
    });

    it("reconcile replaces stale mapping with new session", () => {
      const mapping: SessionMapping = {
        sessionId: "agent-a",
        opencodeSessionId: "sess-stale",
        modelId: "gpt-4.1",
        providerId: "opencode",
      };
      const existingIds = new Set(["sess-live"]);

      const result = reconcileSessionMapping({
        mapping,
        existingSessionIds: existingIds,
        createdSessionId: "sess-new",
      });

      expect(result.shouldReplaceMapping).toBe(true);
      expect(result.sessionId).toBe("sess-new");
    });

    it("reconcile keeps valid mapping without replacement", () => {
      const mapping: SessionMapping = {
        sessionId: "agent-a",
        opencodeSessionId: "sess-live",
        modelId: "gpt-4.1",
        providerId: "opencode",
      };
      const existingIds = new Set(["sess-live"]);

      const result = reconcileSessionMapping({
        mapping,
        existingSessionIds: existingIds,
        createdSessionId: "sess-new",
      });

      expect(result.shouldReplaceMapping).toBe(false);
      expect(result.sessionId).toBe("sess-live");
    });

    it("mappedSessionForId produces session-scoped mapping without HTTP run-id fields", () => {
      const agents = [
        {
          id: "agent-a",
          title: "Test Agent",
          lastUsedAt: "2026-06-10T00:00:00Z",
          opencodeSessionId: "sess-1",
          opencodeModelId: "gpt-4.1",
          opencodeProviderId: "opencode",
        },
      ];

      const mapping = mappedSessionForId(agents, "agent-a");
      expect(mapping).toEqual({
        sessionId: "agent-a",
        opencodeSessionId: "sess-1",
        modelId: "gpt-4.1",
        providerId: "opencode",
      });
      if (mapping) {
        const keys = Object.keys(mapping);
        expect(keys).not.toContain("runId");
        expect(keys).not.toContain("runEndpoint");
      }
    });
  });

  describe("Tool/permission/question flows in workspace", () => {
    it("handles tool.started and tool.completed events in workspace stream", async () => {
      ensureWorkspaceContext("/work/a");
      setupWorkspaceBackend(async function* () {
        yield { type: "message.delta", delta: "Running " };
        yield { type: "tool.started", toolName: "bash", callId: "c1", input: "npm test" };
        yield { type: "message.delta", delta: "tests " };
        yield { type: "tool.completed", toolName: "bash", callId: "c1", output: "passed", isError: false };
        yield { type: "message.delta", delta: "ok." };
        yield { type: "run.completed" };
      });

      const result = await sendChatMessage("Run tests");

      expect(result.ok).toBe(true);
      const assistant = chatStore.getMessages().find((m) => m.role === "assistant");
      expect(assistant?.content).toBe("Running tests ok.");
      expect(assistant?.toolCalls).toHaveLength(1);
      expect(assistant?.toolCalls?.[0]).toMatchObject({
        callId: "c1",
        toolName: "bash",
        status: "success",
      });
    });

    it("handles permission.requested → reply → continue streaming", async () => {
      ensureWorkspaceContext("/work/a");
      const replyPermission = vi.fn().mockResolvedValue(undefined);
      setupWorkspaceBackend(
        async function* () {
          yield { type: "message.delta", delta: "Need " };
          yield {
            type: "permission.requested",
            permissionId: "p1",
            label: "Run shell: ls",
            payload: { tool: "shell" },
          };
          yield { type: "message.delta", delta: "permission" };
          yield { type: "run.completed" };
        },
        { replyPermission },
      );
      promptPermissionMock.mockResolvedValue({ reply: "once" });

      const result = await sendChatMessage("Needs permission");

      expect(result.ok).toBe(true);
      expect(promptPermissionMock).toHaveBeenCalledWith({
        permissionId: "p1",
        label: "Run shell: ls",
        payload: { tool: "shell" },
      });
      expect(replyPermission).toHaveBeenCalledWith({
        workspaceRootPath: "/work/a",
        sessionId: "sess-1",
        requestId: "p1",
        reply: "once",
      });
      expect(
        chatStore.getMessages().find((m) => m.role === "assistant")?.content,
      ).toBe("Need permission");
    });

    it("handles question.requested → reply → continue streaming", async () => {
      ensureWorkspaceContext("/work/a");
      const replyQuestion = vi.fn().mockResolvedValue(undefined);
      setupWorkspaceBackend(
        async function* () {
          yield { type: "message.delta", delta: "Asking " };
          yield {
            type: "question.requested",
            questionId: "q1",
            prompt: "Which one?",
            choices: ["A", "B"],
            payload: null,
          };
          yield { type: "message.delta", delta: "done" };
          yield { type: "run.completed" };
        },
        { replyQuestion },
      );
      promptQuestionMock.mockResolvedValue({ type: "reply", answers: [["A"]] });

      const result = await sendChatMessage("Needs question");

      expect(result.ok).toBe(true);
      expect(promptQuestionMock).toHaveBeenCalledWith({
        questionId: "q1",
        prompt: "Which one?",
        choices: ["A", "B"],
        payload: null,
      });
      expect(replyQuestion).toHaveBeenCalledWith({
        workspaceRootPath: "/work/a",
        sessionId: "sess-1",
        requestId: "q1",
        answers: [["A"]],
      });
      expect(
        chatStore.getMessages().find((m) => m.role === "assistant")?.content,
      ).toBe("Asking done");
    });

    it("handles run.failed by surfacing error to user", async () => {
      ensureWorkspaceContext("/work/a");
      setupWorkspaceBackend(async function* () {
        yield { type: "message.delta", delta: "Working" };
        yield { type: "run.failed", message: "Server crashed" };
      });

      const result = await sendChatMessage("Trigger failure");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("Server crashed");
      }
      expect(chatStore.getRuntimeState().isGenerating).toBe(false);
    });

    it("handles mixed tool success and failure", async () => {
      ensureWorkspaceContext("/work/a");
      setupWorkspaceBackend(async function* () {
        yield { type: "tool.started", toolName: "read_file", callId: "c1", input: { path: "a" } };
        yield { type: "tool.started", toolName: "bash", callId: "c2", input: "bad cmd" };
        yield {
          type: "tool.completed",
          toolName: "read_file",
          callId: "c1",
          output: "contents",
          isError: false,
        };
        yield {
          type: "tool.completed",
          toolName: "bash",
          callId: "c2",
          output: "denied",
          isError: true,
        };
        yield { type: "message.delta", delta: "Done." };
        yield { type: "run.completed" };
      });

      const result = await sendChatMessage("Mixed tools");

      expect(result.ok).toBe(true);
      const assistant = chatStore.getMessages().find((m) => m.role === "assistant");
      expect(assistant?.toolCalls).toHaveLength(2);
      expect(assistant?.toolCalls?.find((tc) => tc.callId === "c1")?.status).toBe("success");
      expect(assistant?.toolCalls?.find((tc) => tc.callId === "c2")?.status).toBe("failure");
    });
  });

  describe("Workspace backend error mapping", () => {
    it("maps auth failure to user-facing message", async () => {
      ensureWorkspaceContext("/work/a");
      createWorkspaceAgentBackendMock.mockReturnValue({
        id: "opencode",
        createSession: vi.fn().mockRejectedValue(
          new WorkspaceAgentBackendError({ code: "authFailure", message: "bad creds" }),
        ),
        getSession: vi.fn(),
        listSessions: vi.fn(),
        deleteSession: vi.fn(),
        send: vi.fn(),
        replyPermission: vi.fn(),
        replyQuestion: vi.fn(),
        rejectQuestion: vi.fn(),
        abortSession: vi.fn(),
        streamEvents: vi.fn(),
      } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);

      const result = await sendChatMessage("Auth fail");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("authentication failed");
      }
    });

    it("maps server unavailable to user-facing message", async () => {
      ensureWorkspaceContext("/work/a");
      createWorkspaceAgentBackendMock.mockReturnValue({
        id: "opencode",
        createSession: vi.fn().mockRejectedValue(
          new WorkspaceAgentBackendError({ code: "serverUnavailable", message: "offline" }),
        ),
        getSession: vi.fn(),
        listSessions: vi.fn(),
        deleteSession: vi.fn(),
        send: vi.fn(),
        replyPermission: vi.fn(),
        replyQuestion: vi.fn(),
        rejectQuestion: vi.fn(),
        abortSession: vi.fn(),
        streamEvents: vi.fn(),
      } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);

      const result = await sendChatMessage("Server down");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("unavailable");
      }
    });
  });

  describe("Workspace cancellation", () => {
    it("cancels workspace stream and calls abortSession", async () => {
      ensureWorkspaceContext("/work/a");
      const abortSession = vi.fn().mockResolvedValue(undefined);
      setupWorkspaceBackend(async function* () {
        yield { type: "message.delta", delta: "partial " };
        await Promise.resolve();
        yield { type: "message.delta", delta: "tail" };
      });
      (createWorkspaceAgentBackendMock.mockReturnValue as (v: unknown) => void)({
        id: "opencode",
        createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
        getSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
        listSessions: vi.fn(),
        deleteSession: vi.fn(),
        send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
        replyPermission: vi.fn(),
        replyQuestion: vi.fn(),
        rejectQuestion: vi.fn(),
        abortSession,
        streamEvents: vi.fn().mockImplementation(async function* () {
          yield { type: "message.delta", delta: "partial " };
          await Promise.resolve();
          yield { type: "message.delta", delta: "tail" };
        }),
      } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
      chatStore.setSessionLink(chatStore.getActiveSessionId()!, { opencodeSessionId: "sess-1" }, "/work/a");

      const sendPromise = sendChatMessage("Cancel me");
      await Promise.resolve();
      const cancelled = chatStore.cancelSessionGeneration("/work/a", chatStore.getActiveSessionId()!);
      expect(cancelled).toBe(true);

      const result = await sendPromise;
      expect(result.ok).toBe(false);
      expect(abortSession).toHaveBeenCalledWith({
        workspaceRootPath: "/work/a",
        sessionId: "sess-1",
      });
      expect(chatStore.getRuntimeState().isGenerating).toBe(false);
    });

    it("cancels immediately while waiting for permission prompt", async () => {
      ensureWorkspaceContext("/work/a");
      const abortSession = vi.fn().mockResolvedValue(undefined);
      const promptNeverResolves = new Promise<{ reply: "once" }>(() => {
        // Intentionally unresolved to simulate user not answering modal yet.
      });
      promptPermissionMock.mockReturnValue(promptNeverResolves);
      (createWorkspaceAgentBackendMock.mockReturnValue as (v: unknown) => void)({
        id: "opencode",
        createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
        getSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
        listSessions: vi.fn(),
        deleteSession: vi.fn(),
        send: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
        replyPermission: vi.fn(),
        replyQuestion: vi.fn(),
        rejectQuestion: vi.fn(),
        abortSession,
        streamEvents: vi.fn().mockImplementation(async function* () {
          yield {
            type: "permission.requested",
            permissionId: "p1",
            label: "Need permission",
            payload: null,
          };
        }),
      } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
      chatStore.setSessionLink(
        chatStore.getActiveSessionId()!,
        { opencodeSessionId: "sess-1" },
        "/work/a",
      );

      const sendPromise = sendChatMessage("Cancel pending permission");
      await Promise.resolve();
      const cancelled = chatStore.cancelSessionGeneration("/work/a", chatStore.getActiveSessionId()!);
      expect(cancelled).toBe(true);

      const result = await sendPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("generating");
      }
      expect(abortSession).toHaveBeenCalledWith({
        workspaceRootPath: "/work/a",
        sessionId: "sess-1",
      });
      expect(chatStore.getRuntimeState().isGenerating).toBe(false);
      expect(chatStore.getRuntimeState().isWaitingForPermission).toBe(false);
    });
  });
});
