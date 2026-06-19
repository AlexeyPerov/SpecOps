import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatStore } from "../state/chatStore";
import { appState } from "../state/appState";
import { defaultDebugProviderSettings } from "./providers/debugProviderSettings";
import {
  registerBothTestDebugProviders,
} from "./providers/debugProviderTestHelpers";
import {
  resetChatProviderRegistryForTests,
} from "./providers/registry";
import { createRegistryCapabilityChecker } from "./providers/capabilityChecker";
import { resetChatProvidersForTests } from "./providers/bootstrap";
import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";
import { createWorkspaceAgentBackend } from "./backends/workspaceAgentBackend";
import {
  createUserMessage,
  findLastUserMessage,
  isWorkspaceSendBlockedWhenOpencodeDisabled,
  resolveChatContextKind,
  shouldUseWorkspaceAgentBackend,
  type ChatContextKind,
} from "./chatSendPipeline";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";

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

const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);
const createWorkspaceAgentBackendMock = vi.mocked(createWorkspaceAgentBackend);

describe("chatSendPipeline utilities", () => {
  describe("createUserMessage", () => {
    it("creates a user message with the given content", () => {
      const message = createUserMessage("Hello world");
      expect(message.role).toBe("user");
      expect(message.content).toBe("Hello world");
      expect(message.id).toMatch(/^msg-/);
      expect(message.createdAt).toBeTruthy();
    });
  });

  describe("findLastUserMessage", () => {
    it("returns the last user message from the list", () => {
      const messages = [
        { id: "1", role: "user" as const, content: "First", createdAt: "" },
        { id: "2", role: "assistant" as const, content: "Reply", createdAt: "" },
        { id: "3", role: "user" as const, content: "Second", createdAt: "" },
      ];
      expect(findLastUserMessage(messages)?.content).toBe("Second");
    });

    it("returns null when no user messages exist", () => {
      const messages = [
        { id: "1", role: "assistant" as const, content: "Reply", createdAt: "" },
      ];
      expect(findLastUserMessage(messages)).toBeNull();
    });

    it("returns null for empty list", () => {
      expect(findLastUserMessage([])).toBeNull();
    });
  });

  describe("resolveChatContextKind", () => {
    it("resolves chat-http for chat-http scope key", () => {
      expect(resolveChatContextKind(CHAT_HTTP_CONTEXT_ID, { chatContextKind: undefined })).toBe("chat-http");
    });

    it("resolves workspace for workspace root paths", () => {
      expect(resolveChatContextKind("/work/a", { chatContextKind: undefined })).toBe("workspace");
    });

    it("uses explicit chatContextKind override", () => {
      expect(resolveChatContextKind(CHAT_HTTP_CONTEXT_ID, { chatContextKind: "chat-http" })).toBe("chat-http");
    });
  });
});

describe("chatSendPipeline workspace backend streaming", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chatStore.reset();
    resetChatProviderRegistryForTests();
    resetChatProvidersForTests();
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

  it("streams deltas interleaved with tool events and accumulates final text", async () => {
    appState.addWorkspace("/work/a");
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: "message.delta", delta: "Let me " };
      yield {
        type: "tool.started",
        toolName: "read_file",
        callId: "call-1",
        input: { path: "a.ts" },
      };
      yield { type: "message.delta", delta: "check " };
      yield {
        type: "tool.completed",
        toolName: "read_file",
        callId: "call-1",
        output: "file contents",
        isError: false,
      };
      yield { type: "message.delta", delta: "this file." };
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

    const { sendChatMessage } = await import("./sendChatMessage");
    const result = await sendChatMessage("Check file");

    expect(result.ok).toBe(true);
    const assistant = chatStore.getMessages().find((m) => m.role === "assistant");
    expect(assistant?.content).toBe("Let me check this file.");
    expect(assistant?.toolCalls).toHaveLength(1);
    expect(assistant?.toolCalls?.[0]).toMatchObject({
      callId: "call-1",
      toolName: "read_file",
      status: "success",
    });
  });

  it("tracks tool progress events during streaming", async () => {
    appState.addWorkspace("/work/a");
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield {
        type: "tool.started",
        toolName: "bash",
        callId: "call-p",
        input: "npm test",
      };
      yield {
        type: "tool.progress",
        toolName: "bash",
        callId: "call-p",
        output: { pct: 50 },
      };
      yield {
        type: "tool.completed",
        toolName: "bash",
        callId: "call-p",
        output: "all passed",
        isError: false,
      };
      yield { type: "message.delta", delta: "Tests passed." };
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

    const { sendChatMessage } = await import("./sendChatMessage");
    const result = await sendChatMessage("Run tests");

    expect(result.ok).toBe(true);
    const assistant = chatStore.getMessages().find((m) => m.role === "assistant");
    expect(assistant?.toolCalls).toHaveLength(1);
    expect(assistant?.toolCalls?.[0]).toMatchObject({
      callId: "call-p",
      toolName: "bash",
      status: "success",
      output: "all passed",
    });
  });

  it("handles run.failed event by surfacing error and cleaning up", async () => {
    appState.addWorkspace("/work/a");
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: "message.delta", delta: "Working" };
      yield { type: "run.failed", message: "Server error occurred" };
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

    const { sendChatMessage } = await import("./sendChatMessage");
    const result = await sendChatMessage("Trigger failure");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Server error occurred");
      expect(result.reason).toBe("provider_error");
    }
    expect(chatStore.getRuntimeState().isGenerating).toBe(false);
  });

  it("handles multiple tool calls with success and failure", async () => {
    appState.addWorkspace("/work/a");
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: "tool.started", toolName: "read_file", callId: "c1", input: { path: "a" } };
      yield { type: "tool.started", toolName: "bash", callId: "c2", input: "rm -rf /" };
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
        output: "permission denied",
        isError: true,
      };
      yield { type: "message.delta", delta: "Done." };
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

    const { sendChatMessage } = await import("./sendChatMessage");
    const result = await sendChatMessage("Multi tool");

    expect(result.ok).toBe(true);
    const assistant = chatStore.getMessages().find((m) => m.role === "assistant");
    expect(assistant?.toolCalls).toHaveLength(2);
    const readCall = assistant?.toolCalls?.find((tc) => tc.callId === "c1");
    const bashCall = assistant?.toolCalls?.find((tc) => tc.callId === "c2");
    expect(readCall?.status).toBe("success");
    expect(bashCall?.status).toBe("failure");
  });

  it("handles message.completed event replacing accumulated deltas", async () => {
    appState.addWorkspace("/work/a");
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: "message.delta", delta: "Partial" };
      yield { type: "message.completed", message: "Final complete message" };
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

    const { sendChatMessage } = await import("./sendChatMessage");
    const result = await sendChatMessage("Complete message");

    expect(result.ok).toBe(true);
    const assistant = chatStore.getMessages().find((m) => m.role === "assistant");
    expect(assistant?.content).toBe("Final complete message");
  });

  it("accumulates reasoning / subtask / step parts live during the turn", async () => {
    appState.addWorkspace("/work/a");
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: "reasoning.delta", reasoningId: "r1", delta: "Let me think" };
      yield {
        type: "step.started",
        stepId: "st0",
        agent: "build",
        modelId: "m",
        providerId: "p",
      };
      yield { type: "message.delta", delta: "Working " };
      yield {
        type: "subtask.started",
        subtaskId: "s1",
        agent: "research",
        description: "look it up",
        prompt: "find the answer",
      };
      yield { type: "message.delta", delta: "on it" };
      yield {
        type: "step.finished",
        stepId: "st0",
        reason: "stop",
        cost: 0.012,
        tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      };
      yield { type: "reasoning.ended", reasoningId: "r1", text: "Let me think it through" };
      yield { type: "message.completed", message: "Working on it" };
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

    const { sendChatMessage } = await import("./sendChatMessage");
    const result = await sendChatMessage("Plan it");

    expect(result.ok).toBe(true);
    const assistant = chatStore.getMessages().find((m) => m.role === "assistant");
    expect(assistant?.content).toBe("Working on it");
    // The assistant message carries reasoning, subtask, and step parts that
    // render via the same extractors as the hydrated (session.messages) view.
    const reasoningPart = assistant?.parts?.find((p) => p.type === "reasoning");
    expect(reasoningPart).toMatchObject({ type: "reasoning", id: "r1", text: "Let me think it through" });
    const subtaskPart = assistant?.parts?.find((p) => p.type === "subtask");
    expect(subtaskPart).toMatchObject({
      type: "subtask",
      id: "s1",
      agent: "research",
      status: "running",
    });
    const stepParts = assistant?.parts?.filter((p) => p.type === "step") ?? [];
    expect(stepParts).toHaveLength(2);
    expect(stepParts[0]).toMatchObject({ phase: "start", index: 0, id: "st0" });
    expect(stepParts[1]).toMatchObject({
      phase: "finish",
      index: 0,
      id: "st0",
      cost: 0.012,
      reason: "stop",
    });
  });

  it("surfaces step.failed as a token-less finish part during the turn", async () => {
    appState.addWorkspace("/work/a");
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: "step.started", stepId: "st0", agent: null, modelId: null, providerId: null };
      yield { type: "step.failed", stepId: "st0", message: "rate limited" };
      yield { type: "message.completed", message: "Could not finish." };
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

    const { sendChatMessage } = await import("./sendChatMessage");
    const result = await sendChatMessage("Try it");

    expect(result.ok).toBe(true);
    const assistant = chatStore.getMessages().find((m) => m.role === "assistant");
    const finishPart = assistant?.parts?.find(
      (p) => p.type === "step" && "phase" in p && p.phase === "finish",
    );
    expect(finishPart).toMatchObject({ type: "step", phase: "finish", reason: "rate limited" });
    expect(finishPart).not.toHaveProperty("tokens");
  });

  it("preserves tool call state after cancellation during tool execution", async () => {
    appState.addWorkspace("/work/a");
    const abortSession = vi.fn().mockResolvedValue(undefined);
    const streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: "tool.started", toolName: "bash", callId: "c1", input: "long job" };
      yield {
        type: "tool.progress",
        toolName: "bash",
        callId: "c1",
        output: { pct: 25 },
      };
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
      abortSession,
      streamEvents,
    } as unknown as ReturnType<typeof createWorkspaceAgentBackend>);
    chatStore.setAgentSessionLink(chatStore.getActiveAgentId()!, { opencodeSessionId: "sess-1" }, "/work/a");

    const { sendChatMessage } = await import("./sendChatMessage");
    const sendPromise = sendChatMessage("Long job");
    await Promise.resolve();
    const cancelled = chatStore.cancelAgentGeneration("/work/a", chatStore.getActiveAgentId()!);
    expect(cancelled).toBe(true);

    const result = await sendPromise;
    expect(result.ok).toBe(false);
    expect(chatStore.getRuntimeState().isGenerating).toBe(false);
  });
});

describe("OpenCode opt-in gating", () => {
  beforeEach(() => {
    chatStore.reset();
    appState.addWorkspace("/work/a");
    chatStore.setActiveWorkspaceRoot("/work/a");
    appState.applyPersistedSettings({
      opencode: { enabled: true, mode: "sidecar", baseUrl: "http://127.0.0.1:4096" },
    });
  });

  it("shouldUseWorkspaceAgentBackend returns true when enabled", () => {
    appState.applyPersistedSettings({
      opencode: { enabled: true, mode: "sidecar", baseUrl: "http://127.0.0.1:4096" },
    });
    expect(
      shouldUseWorkspaceAgentBackend({ root: "/work/a", chatContextKind: "workspace" }),
    ).toBe(true);
  });

  it("shouldUseWorkspaceAgentBackend returns false when disabled", () => {
    appState.applyPersistedSettings({
      opencode: { enabled: false, mode: "sidecar", baseUrl: "http://127.0.0.1:4096" },
    });
    expect(
      shouldUseWorkspaceAgentBackend({ root: "/work/a", chatContextKind: "workspace" }),
    ).toBe(false);
  });

  it("isWorkspaceSendBlockedWhenOpencodeDisabled returns true when disabled", () => {
    appState.applyPersistedSettings({
      opencode: { enabled: false, mode: "sidecar", baseUrl: "http://127.0.0.1:4096" },
    });
    expect(
      isWorkspaceSendBlockedWhenOpencodeDisabled({ root: "/work/a", chatContextKind: "workspace" }),
    ).toBe(true);
  });

  it("isWorkspaceSendBlockedWhenOpencodeDisabled returns false when enabled", () => {
    appState.applyPersistedSettings({
      opencode: { enabled: true, mode: "sidecar", baseUrl: "http://127.0.0.1:4096" },
    });
    expect(
      isWorkspaceSendBlockedWhenOpencodeDisabled({ root: "/work/a", chatContextKind: "workspace" }),
    ).toBe(false);
  });

  it("isWorkspaceSendBlockedWhenOpencodeDisabled returns false for chat-http", () => {
    appState.applyPersistedSettings({
      opencode: { enabled: false, mode: "sidecar", baseUrl: "http://127.0.0.1:4096" },
    });
    expect(
      isWorkspaceSendBlockedWhenOpencodeDisabled({ root: CHAT_HTTP_CONTEXT_ID, chatContextKind: "chat-http" }),
    ).toBe(false);
  });

  it("chat-http backend routing ignores opencode enabled flag", () => {
    appState.applyPersistedSettings({
      opencode: { enabled: false, mode: "sidecar", baseUrl: "http://127.0.0.1:4096" },
    });
    expect(
      shouldUseWorkspaceAgentBackend({ root: CHAT_HTTP_CONTEXT_ID, chatContextKind: "chat-http" }),
    ).toBe(false);
  });
});
