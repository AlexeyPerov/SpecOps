import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import { chatStore, formatCompactionNotice, resetAgentIdCounterForTests } from "./chatStore";
import { DRAFT_AGENT_TITLE } from "../services/chatAgents";
import type { ChatThreadSnapshot } from "../domain/contracts";
import { WorkspaceAccessReason, type CapabilityChecker } from "../ai/capabilities";
import {
  WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
  WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
} from "../ai/chatErrorCopy";
import {
  deleteAgentPersistence,
  readAgentThreadFileSnapshot,
  readWorkspaceAgentsIndexSnapshot,
} from "../services/chatPersistence";
import { setChatRetentionMaxTurnsForTests } from "../services/chatRetention";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";
import { defaultAppProviderSettings } from "../ai/providers/appProviderSettings";
import {
  createTestCapabilityChecker,
  registerTestDebugWorkspaceProvider,
} from "../ai/providers/debugProviderTestHelpers";
import { appState } from "./appState";
import { defaultDebugProviderSettings } from "../ai/providers/debugProviderSettings";
import { defaultHttpConnectionSettings } from "../ai/providers/httpConnectionSettings";
import { defaultProviderModelCatalogs } from "../ai/providers/providerModelCatalog";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "../ai/providers/registry";

vi.mock("../services/chatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/chatPersistence")>();
  return {
    ...actual,
    readAgentThreadFileSnapshot: vi.fn(),
    readWorkspaceAgentsIndexSnapshot: vi.fn(),
    deleteAgentPersistence: vi.fn(),
  };
});

vi.mock("../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
}));

const readAgentThreadFileSnapshotMock = vi.mocked(readAgentThreadFileSnapshot);
const readWorkspaceAgentsIndexSnapshotMock = vi.mocked(readWorkspaceAgentsIndexSnapshot);
const deleteAgentPersistenceMock = vi.mocked(deleteAgentPersistence);
const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);

function providerSwitchOptions() {
  return {
    providerSettings: appState.getSnapshot().settings.providerSettings,
    providerModelCatalogs: defaultProviderModelCatalogs,
  };
}

describe("chatStore", () => {
  beforeEach(() => {
    chatStore.reset();
    chatStore.setCapabilityChecker(null);
    setChatRetentionMaxTurnsForTests(undefined);
    resetAgentIdCounterForTests();
    readAgentThreadFileSnapshotMock.mockReset();
    readWorkspaceAgentsIndexSnapshotMock.mockReset();
    readWorkspaceAgentsIndexSnapshotMock.mockResolvedValue({ version: 1, agents: [] });
    deleteAgentPersistenceMock.mockReset();
    deleteAgentPersistenceMock.mockResolvedValue(undefined);
    ensureWorkspaceReadAccessMock.mockReset();
  });

  it("creates thread lazily on first user message", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    const created = chatStore.appendMessage({
      id: "m-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-25T00:00:00.000Z",
    });

    expect(created).toBe(true);
    expect(chatStore.hasThread()).toBe(true);
    expect(chatStore.isEmpty()).toBe(false);
    expect(chatStore.getMetadata()).toMatchObject({
      agentId: "agent-1",
      threadId: "agent-1",
      mode: "ask",
      provider: "http",
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:00.000Z",
    });
    expect(chatStore.getMessages()).toHaveLength(1);
  });

  it("appends message and updates metadata values", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "m-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-25T00:00:00.000Z",
    });
    const appended = chatStore.appendMessage({
      id: "m-2",
      role: "assistant",
      content: "hi",
      createdAt: "2026-05-25T00:00:01.000Z",
    });

    const metadataUpdated = chatStore.updateThreadMetadata(
      { mode: "review", provider: "debug-workspace", summary: "brief summary" },
      "2026-05-25T00:00:02.000Z",
    );

    expect(appended).toBe(true);
    expect(metadataUpdated).toBe(true);
    expect(chatStore.getMessages().map((message) => message.id)).toEqual(["m-1", "m-2"]);
    expect(chatStore.getMetadata()).toEqual({
      agentId: "agent-1",
      threadId: "agent-1",
      mode: "review",
      provider: "debug-workspace",
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:02.000Z",
      summary: "brief summary",
    });
  });

  it("creates an empty thread when mode is selected before the first message", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");

    const updated = chatStore.updateThreadMetadata({ mode: "review" }, "2026-05-26T00:00:00.000Z");

    expect(updated).toBe(true);
    expect(chatStore.getMessages()).toEqual([]);
    expect(chatStore.getMetadata()).toEqual({
      agentId: "agent-1",
      threadId: "agent-1",
      mode: "review",
      provider: "http",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
    });
  });

  it("compacts oldest turns when append exceeds retention cap", () => {
    setChatRetentionMaxTurnsForTests(2);
    chatStore.setActiveWorkspaceRoot("/work/a");

    for (let index = 1; index <= 3; index += 1) {
      chatStore.appendMessage({
        id: `u-${index}`,
        role: "user",
        content: `turn-${index}`,
        createdAt: `2026-05-26T00:00:0${index}.000Z`,
      });
      chatStore.appendMessage({
        id: `a-${index}`,
        role: "assistant",
        content: `reply-${index}`,
        createdAt: `2026-05-26T00:00:1${index}.000Z`,
      });
    }

    expect(chatStore.getMessages().map((message) => message.id)).toEqual([
      "u-2",
      "a-2",
      "u-3",
      "a-3",
    ]);

    chatStore.appendMessage({
      id: "u-4",
      role: "user",
      content: "turn-4",
      createdAt: "2026-05-26T00:00:40.000Z",
    });

    expect(chatStore.getMessages().map((message) => message.id)).toEqual([
      "u-3",
      "a-3",
      "u-4",
    ]);
    expect(chatStore.getMetadata()).toMatchObject({
      mode: "ask",
      provider: "http",
      createdAt: "2026-05-26T00:00:01.000Z",
      compactionCount: 2,
      compactedMessageCount: 4,
    });
    expect(chatStore.getMetadata()?.lastCompactedAt).toBeDefined();
  });

  it("switches active thread state when changing active agent", () => {
    const threadA: ChatThreadSnapshot = {
      metadata: {
        agentId: "agent-a",
        threadId: "agent-a",
        mode: "ask",
        provider: "http",
        createdAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      messages: [
        {
          id: "a-1",
          role: "user",
          content: "A",
          createdAt: "2026-05-25T00:00:00.000Z",
        },
      ],
    };

    const threadB: ChatThreadSnapshot = {
      metadata: {
        agentId: "agent-b",
        threadId: "agent-b",
        mode: "review",
        provider: "debug-workspace",
        createdAt: "2026-05-25T00:00:03.000Z",
        updatedAt: "2026-05-25T00:00:03.000Z",
      },
      messages: [
        {
          id: "b-1",
          role: "user",
          content: "B",
          createdAt: "2026-05-25T00:00:03.000Z",
        },
      ],
    };

    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.setAgentThread("agent-a", threadA);
    chatStore.setAgentThread("agent-b", threadB);
    chatStore.setActiveAgentId("agent-a");
    expect(chatStore.getMessages().map((message) => message.id)).toEqual(["a-1"]);
    expect(chatStore.getMetadata()?.mode).toBe("ask");

    chatStore.setActiveAgentId("agent-b");
    expect(chatStore.getMessages().map((message) => message.id)).toEqual(["b-1"]);
    expect(chatStore.getMetadata()?.mode).toBe("review");
    expect(chatStore.getMetadata()?.provider).toBe("debug-workspace");
  });

  it("loads workspace agents from index and thread files", async () => {
    const threadA: ChatThreadSnapshot = {
      metadata: {
        agentId: "agent-a",
        threadId: "agent-a",
        mode: "ask",
        provider: "http",
        createdAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      messages: [
        {
          id: "a-1",
          role: "user",
          content: "A",
          createdAt: "2026-05-25T00:00:00.000Z",
        },
      ],
    };

    readWorkspaceAgentsIndexSnapshotMock.mockResolvedValue({
      version: 1,
      agents: [{ id: "agent-a", title: "A", lastUsedAt: "2026-05-25T00:00:00.000Z" }],
    });
    readAgentThreadFileSnapshotMock.mockResolvedValue(threadA);

    chatStore.setActiveWorkspaceRoot("/work/a");
    await chatStore.loadWorkspaceAgents("/work/a");

    expect(chatStore.getActiveAgentId()).toBeNull();
    chatStore.setActiveAgentId("agent-a");
    expect(chatStore.getMessages()).toEqual(threadA.messages);
  });

  it("mergeSessionDraftAgents adds draft entries for open tab ids missing from disk index", async () => {
    readWorkspaceAgentsIndexSnapshotMock.mockResolvedValue({
      version: 1,
      agents: [{ id: "agent-a", title: "A", lastUsedAt: "2026-05-25T00:00:00.000Z" }],
    });
    readAgentThreadFileSnapshotMock.mockResolvedValue(null);

    chatStore.setActiveWorkspaceRoot("/work/a");
    await chatStore.loadWorkspaceAgents("/work/a");
    chatStore.mergeSessionDraftAgents("/work/a", ["agent-draft-tab"]);

    const index = chatStore.getAgentIndex();
    expect(index.some((entry) => entry.id === "agent-draft-tab" && entry.isDraft)).toBe(true);
    expect(index.some((entry) => entry.id === "agent-a")).toBe(true);
  });

  it("shows empty state when workspace has no persisted thread", async () => {
    readAgentThreadFileSnapshotMock.mockResolvedValue(null);

    chatStore.setActiveWorkspaceRoot("/work/empty");
    await chatStore.loadWorkspaceThread("/work/empty");

    expect(chatStore.hasThread()).toBe(false);
    expect(chatStore.isEmpty()).toBe(true);
    expect(chatStore.getMessages()).toEqual([]);
    expect(chatStore.getMetadata()).toBeNull();
  });

  it("scopes chat-http agents separately from workspace agents", async () => {
    const workspaceIndex = {
      version: 1 as const,
      agents: [{ id: "ws-agent", title: "Workspace", lastUsedAt: "2026-06-05T00:00:00.000Z" }],
    };
    const chatHttpIndex = {
      version: 1 as const,
      agents: [{ id: "http-agent", title: "Chat HTTP", lastUsedAt: "2026-06-05T00:00:01.000Z" }],
    };

    readWorkspaceAgentsIndexSnapshotMock.mockImplementation(async (scopeKey: string) => {
      if (scopeKey === CHAT_HTTP_CONTEXT_ID) {
        return chatHttpIndex;
      }
      return workspaceIndex;
    });

    chatStore.setActiveWorkspaceRoot("/work/a");
    await chatStore.loadWorkspaceAgents("/work/a");
    expect(chatStore.getAgentIndex().map((entry) => entry.id)).toEqual(["ws-agent"]);

    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    await chatStore.loadWorkspaceAgents(CHAT_HTTP_CONTEXT_ID);
    expect(chatStore.getActiveChatScopeKey()).toBe(CHAT_HTTP_CONTEXT_ID);
    expect(chatStore.getActiveWorkspaceRoot()).toBeNull();
    expect(chatStore.getAgentIndex().map((entry) => entry.id)).toEqual(["http-agent"]);

    chatStore.setActiveWorkspaceRoot("/work/a");
    expect(chatStore.getAgentIndex().map((entry) => entry.id)).toEqual(["ws-agent"]);
  });

  it("normalizes persisted chat-http review mode threads to ask on load", async () => {
    const chatHttpThread: ChatThreadSnapshot = {
      metadata: {
        agentId: "http-agent",
        threadId: "http-agent",
        mode: "review",
        provider: "http",
        createdAt: "2026-06-05T00:00:00.000Z",
        updatedAt: "2026-06-05T00:00:01.000Z",
      },
      messages: [
        {
          id: "m-1",
          role: "user",
          content: "legacy review",
          createdAt: "2026-06-05T00:00:00.000Z",
        },
      ],
    };

    readWorkspaceAgentsIndexSnapshotMock.mockResolvedValue({
      version: 1,
      agents: [{ id: "http-agent", title: "Chat HTTP", lastUsedAt: "2026-06-05T00:00:01.000Z" }],
    });
    readAgentThreadFileSnapshotMock.mockResolvedValue(chatHttpThread);

    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    await chatStore.loadWorkspaceAgents(CHAT_HTTP_CONTEXT_ID);
    chatStore.setActiveAgentId("http-agent");

    expect(chatStore.getMetadata()?.mode).toBe("ask");
  });

  it("clears active chat binding in notepad mode", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "m-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-25T00:00:00.000Z",
    });
    expect(chatStore.hasThread()).toBe(true);

    chatStore.setActiveWorkspaceRoot(null);

    expect(chatStore.hasThread()).toBe(false);
    expect(chatStore.isEmpty()).toBe(true);
    expect(chatStore.getMessages()).toEqual([]);
    expect(chatStore.getMetadata()).toBeNull();
  });

  it("returns unknown capability status when checker is not configured", async () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "m-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-26T00:00:00.000Z",
    });

    const result = await chatStore.checkActiveWorkspaceCapabilities();

    expect(result).toMatchObject({
      status: "blocked",
      reason: WorkspaceAccessReason.ProviderUnsupported,
    });
  });

  it("checks active workspace capabilities through configured checker", async () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "m-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-26T00:00:00.000Z",
    });

    const checker: CapabilityChecker = {
      checkCapabilities: vi.fn().mockResolvedValue({
        status: "blocked",
        reason: WorkspaceAccessReason.ProviderUnsupported,
        capabilities: {
          canReadWorkspaceFiles: false,
          supportedModes: ["ask"],
        },
        message: "Provider does not support workspace reads.",
        recoveryHint: "Switch provider.",
      }),
    };
    chatStore.setCapabilityChecker(checker);

    const result = await chatStore.checkActiveWorkspaceCapabilities();

    expect(checker.checkCapabilities).toHaveBeenCalledWith({
      provider: "http",
      mode: "ask",
      workspaceRootPath: "/work/a",
    });
    expect(result).toEqual({
      status: "blocked",
      reason: WorkspaceAccessReason.ProviderUnsupported,
      capabilities: {
        canReadWorkspaceFiles: false,
        supportedModes: ["ask"],
      },
      message: "Provider does not support workspace reads.",
      recoveryHint: "Switch provider.",
    });
  });

  it("blocks preflight when workspace path is inaccessible", async () => {
    ensureWorkspaceReadAccessMock.mockResolvedValue("blocked");
    chatStore.setActiveWorkspaceRoot("/work/blocked");

    const result = await chatStore.runAccessPreflight();

    expect(result).toEqual({
      status: "blocked",
      reason: WorkspaceAccessReason.WorkspacePathInaccessible,
      message: WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
      recoveryHint: WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
      checkedAt: result.checkedAt,
    });
    expect(chatStore.getChatAccessState()).toEqual(result);
  });

  it("records workspace access loss in thread when ready transitions to blocked", async () => {
    const readyChecker: CapabilityChecker = {
      checkCapabilities: vi.fn().mockResolvedValue({
        status: "ready",
        reason: WorkspaceAccessReason.Unknown,
        capabilities: {
          canReadWorkspaceFiles: true,
          supportedModes: ["ask", "review"],
        },
        message: "Ready",
      }),
    };
    chatStore.setCapabilityChecker(readyChecker);
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "m-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-26T00:00:00.000Z",
    });

    const readyResult = await chatStore.runAccessPreflight();
    expect(readyResult.status).toBe("ready");
    expect(chatStore.getMessages()).toHaveLength(1);

    ensureWorkspaceReadAccessMock.mockResolvedValue("blocked");
    const blockedResult = await chatStore.runAccessPreflight();

    expect(blockedResult.status).toBe("blocked");
    expect(blockedResult.reason).toBe(WorkspaceAccessReason.WorkspacePathInaccessible);
    expect(chatStore.getMessages()).toHaveLength(2);
    expect(chatStore.getMessages()[1]).toMatchObject({
      role: "system",
      content: expect.stringContaining("Workspace file access was lost"),
    });
    expect(chatStore.appendMessage({
      id: "m-2",
      role: "user",
      content: "blocked send",
      createdAt: "2026-05-26T00:00:01.000Z",
    })).toBe(false);
    expect(chatStore.getMessages()).toHaveLength(2);
  });

  it("does not duplicate access-loss system messages on repeated blocked preflight", async () => {
    const readyChecker: CapabilityChecker = {
      checkCapabilities: vi.fn().mockResolvedValue({
        status: "ready",
        reason: WorkspaceAccessReason.Unknown,
        capabilities: {
          canReadWorkspaceFiles: true,
          supportedModes: ["ask"],
        },
        message: "Ready",
      }),
    };
    chatStore.setCapabilityChecker(readyChecker);
    ensureWorkspaceReadAccessMock.mockResolvedValueOnce("ready").mockResolvedValue("blocked");
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "m-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-26T00:00:00.000Z",
    });
    await chatStore.runAccessPreflight();
    await chatStore.runAccessPreflight();
    await chatStore.runAccessPreflight();

    const systemMessages = chatStore
      .getMessages()
      .filter((message) => message.role === "system");
    expect(systemMessages).toHaveLength(1);
  });

  it("returns stub blocked state when preflight runs without real checker", async () => {
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "m-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-26T00:00:00.000Z",
    });

    const result = await chatStore.runAccessPreflight();

    expect(result).toMatchObject({
      status: "blocked",
      reason: WorkspaceAccessReason.ProviderUnsupported,
      message: "Provider capability checks are not integrated yet for this milestone.",
    });
    expect(chatStore.getChatAccessState()).toEqual(result);
  });

  it("clears active workspace chat history in memory and on disk", async () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "m-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-26T00:00:00.000Z",
    });

    const cleared = await chatStore.clearActiveWorkspaceChatHistory();

    expect(cleared).toBe(true);
    expect(chatStore.hasThread()).toBe(false);
    expect(chatStore.isEmpty()).toBe(true);
    expect(chatStore.getMessages()).toEqual([]);
    expect(deleteAgentPersistenceMock).toHaveBeenCalledWith("/work/a", "agent-1");
  });

  it("clear history returns false when no active agent exists", async () => {
    chatStore.setActiveWorkspaceRoot("/work/a");

    await expect(chatStore.clearActiveWorkspaceChatHistory()).resolves.toBe(false);
    expect(deleteAgentPersistenceMock).not.toHaveBeenCalled();
  });

  it("clear history affects only the active agent", async () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.setAgentThread("agent-a", {
      metadata: {
        agentId: "agent-a",
        threadId: "agent-a",
        mode: "ask",
        provider: "http",
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
      },
      messages: [
        {
          id: "a-1",
          role: "user",
          content: "A",
          createdAt: "2026-05-26T00:00:00.000Z",
        },
      ],
    });
    chatStore.setAgentThread("agent-b", {
      metadata: {
        agentId: "agent-b",
        threadId: "agent-b",
        mode: "review",
        provider: "debug-workspace",
        createdAt: "2026-05-26T00:00:01.000Z",
        updatedAt: "2026-05-26T00:00:01.000Z",
      },
      messages: [
        {
          id: "b-1",
          role: "user",
          content: "B",
          createdAt: "2026-05-26T00:00:01.000Z",
        },
      ],
    });
    chatStore.setActiveAgentId("agent-a");

    await chatStore.clearActiveWorkspaceChatHistory();

    const workspace = chatStore.getWorkspaceAgentsState("/work/a");
    expect(workspace?.threadsByAgentId["agent-a"]).toBeUndefined();
    expect(workspace?.threadsByAgentId["agent-b"]?.messages[0]?.content).toBe("B");
    expect(deleteAgentPersistenceMock).toHaveBeenCalledWith("/work/a", "agent-a");
    expect(deleteAgentPersistenceMock).not.toHaveBeenCalledWith("/work/a", "agent-b");
  });

  it("allows parallel generation on two agents in the same workspace", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.updateThreadMetadata({ mode: "ask", provider: "http" }, "2026-05-26T00:00:00.000Z", "agent-a");
    chatStore.updateThreadMetadata({ mode: "ask", provider: "http" }, "2026-05-26T00:00:00.000Z", "agent-b");

    expect(chatStore.beginTurn("turn-a", "agent-a")).toBe(true);
    expect(chatStore.beginTurn("turn-b", "agent-b")).toBe(true);
    expect(chatStore.getRuntimeState("agent-a").isGenerating).toBe(true);
    expect(chatStore.getRuntimeState("agent-b").isGenerating).toBe(true);
    expect(chatStore.beginTurn("turn-a-2", "agent-a")).toBe(false);
    expect(chatStore.beginTurn("turn-b-2", "agent-b")).toBe(false);
  });

  it("deleteAgent clears thread, runtime, and index entry", async () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.setActiveAgentId("agent-a");
    chatStore.appendMessage({
      id: "m-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-26T00:00:00.000Z",
    });
    chatStore.beginTurn("turn-1", "agent-a");
    chatStore.failTurn({ message: "failed" }, "turn-1", "agent-a");

    await chatStore.deleteAgent("agent-a");

    const workspace = chatStore.getWorkspaceAgentsState("/work/a");
    expect(workspace?.threadsByAgentId["agent-a"]).toBeUndefined();
    expect(workspace?.runtimeByAgentId["agent-a"]).toBeUndefined();
    expect(workspace?.agentIndex.some((entry) => entry.id === "agent-a")).toBe(false);
    expect(deleteAgentPersistenceMock).toHaveBeenCalledWith("/work/a", "agent-a");
  });

  it("tracks turn lifecycle through begin, complete, and fail transitions", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.createDraftAgent();

    expect(chatStore.beginTurn("turn-1")).toBe(true);
    expect(chatStore.getRuntimeState()).toMatchObject({
      isGenerating: true,
      activeTurnId: "turn-1",
      lastFailedTurnId: null,
      lastError: null,
    });
    expect(chatStore.canRetryLastTurn()).toBe(false);

    expect(chatStore.completeTurn()).toBe(true);
    expect(chatStore.getRuntimeState()).toMatchObject({
      isGenerating: false,
      activeTurnId: null,
      lastFailedTurnId: null,
      lastError: null,
    });

    expect(chatStore.beginTurn("turn-2")).toBe(true);
    expect(chatStore.failTurn({ message: "Provider timeout", code: "timeout" })).toBe(true);
    expect(chatStore.getRuntimeState()).toMatchObject({
      isGenerating: false,
      activeTurnId: null,
      lastFailedTurnId: "turn-2",
      lastError: { message: "Provider timeout", code: "timeout" },
    });
    expect(chatStore.canRetryLastTurn()).toBe(true);
    expect(chatStore.beginTurn("turn-3")).toBe(true);
    expect(chatStore.getRuntimeState().lastFailedTurnId).toBeNull();
    expect(chatStore.canRetryLastTurn()).toBe(false);
  });

  it("keeps failed turn metadata scoped per agent", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.updateThreadMetadata({ mode: "ask" }, "2026-05-26T00:00:00.000Z", "agent-a");
    chatStore.updateThreadMetadata({ mode: "ask" }, "2026-05-26T00:00:00.000Z", "agent-b");
    chatStore.beginTurn("turn-a", "agent-a");
    chatStore.failTurn({ message: "failed in A" }, "turn-a", "agent-a");

    expect(chatStore.getRuntimeState("agent-b")).toMatchObject({
      isGenerating: false,
      lastFailedTurnId: null,
      lastError: null,
    });

    expect(chatStore.getRuntimeState("agent-a")).toMatchObject({
      lastFailedTurnId: "turn-a",
      lastError: { message: "failed in A" },
    });
    expect(chatStore.canRetryLastTurn("agent-a")).toBe(true);
  });

  it("cancelAgentGeneration clears runtime and partial assistant for a workspace agent", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    const agentId = chatStore.createDraftAgent();
    chatStore.appendMessage(
      {
        id: "user-1",
        role: "user",
        content: "Hello",
        createdAt: "2026-05-28T12:00:00.000Z",
      },
      { agentId: agentId! },
    );
    chatStore.beginTurn("turn-1", agentId!);
    chatStore.appendMessage(
      {
        id: "assistant-turn-1",
        role: "assistant",
        content: "Partial",
        createdAt: "2026-05-28T12:00:01.000Z",
      },
      { agentId: agentId!, skipCompaction: true },
    );

    expect(chatStore.cancelAgentGeneration("/work/a", agentId!)).toBe(true);
    expect(chatStore.getRuntimeState(agentId!, "/work/a").isGenerating).toBe(false);
    expect(
      chatStore
        .getWorkspaceAgentsState("/work/a")
        ?.threadsByAgentId[agentId!]?.messages.some((message) => message.id === "assistant-turn-1"),
    ).toBe(false);
  });

  it("clears retry runtime state when chat history is cleared", async () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.createDraftAgent();
    chatStore.beginTurn("turn-1");
    chatStore.failTurn({ message: "failed" });

    await chatStore.clearActiveWorkspaceChatHistory();

    expect(chatStore.getRuntimeState()).toMatchObject({
      isGenerating: false,
      lastFailedTurnId: null,
      lastError: null,
    });
    expect(chatStore.canRetryLastTurn()).toBe(false);
  });

  it("formats compaction notice copy for the chat banner", () => {
    expect(formatCompactionNotice(1)).toBe(
      "1 older message compacted to stay within chat retention limits.",
    );
    expect(formatCompactionNotice(24)).toBe(
      "24 older messages compacted to stay within chat retention limits.",
    );
  });

  it("createDraftAgent adds session draft without in-memory thread", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    const agentId = chatStore.createDraftAgent();

    expect(agentId).toBe("agent-1");
    expect(chatStore.getActiveAgentId()).toBe("agent-1");
    expect(chatStore.isAgentDraft("agent-1")).toBe(true);
    expect(chatStore.getAgentTitle("agent-1")).toBe(DRAFT_AGENT_TITLE);
    expect(chatStore.getActiveThreadSnapshot("agent-1")).toBeNull();
    expect(chatStore.hasThread("agent-1")).toBe(false);
  });

  it("supports multiple concurrent draft agents with distinct ids", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    const firstId = chatStore.createDraftAgent();
    const secondId = chatStore.createDraftAgent({ activate: true });

    expect(firstId).toBe("agent-1");
    expect(secondId).toBe("agent-2");
    expect(chatStore.getActiveAgentId()).toBe("agent-2");
    expect(chatStore.getAgentIndex().map((entry) => entry.id)).toEqual(["agent-1", "agent-2"]);
    expect(chatStore.getAgentIndex().every((entry) => entry.title === DRAFT_AGENT_TITLE)).toBe(true);
    expect(chatStore.getAgentIndex().every((entry) => entry.isDraft)).toBe(true);
  });

  it("promotes draft title and clears isDraft on first user message", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    const agentId = chatStore.createDraftAgent();
    expect(agentId).not.toBeNull();

    chatStore.appendMessage(
      {
        id: "m-1",
        role: "user",
        content: "First line of the agent\nsecond line",
        createdAt: "2026-05-28T12:00:00.000Z",
      },
      { agentId: agentId! },
    );

    expect(chatStore.isAgentDraft(agentId!)).toBe(false);
    expect(chatStore.getAgentTitle(agentId!)).toBe("First line of the agent");
    const entry = chatStore.getAgentIndex().find((item) => item.id === agentId);
    expect(entry?.isDraft).toBeUndefined();
    expect(entry?.lastUsedAt).toBe("2026-05-28T12:00:00.000Z");
  });
});

describe("chatStore provider switching", () => {
  beforeEach(() => {
    chatStore.reset();
    resetChatProviderRegistryForTests();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    registerTestDebugWorkspaceProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: true,
    }));
    chatStore.setCapabilityChecker(createTestCapabilityChecker());
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });
  });

  it("appends a provider-switched system event and updates metadata", async () => {
    const result = await chatStore.switchThreadProvider("debug-workspace", providerSwitchOptions());

    expect(result.switched).toBe(true);
    expect(chatStore.getMetadata()?.provider).toBe("debug-workspace");
    expect(chatStore.getMessages().at(-1)).toMatchObject({
      role: "system",
      content: "Provider switched from HTTP to Debug Provider.",
      systemEvent: {
        type: "provider-switched",
        fromProvider: "http",
        toProvider: "debug-workspace",
      },
    });
  });

  it("blocks switching to Debug when it is disabled in settings", async () => {
    const result = await chatStore.switchThreadProvider("debug-workspace", {
      ...providerSwitchOptions(),
      providerSettings: { ...appState.getSnapshot().settings.providerSettings, debugWorkspace: { ...appState.getSnapshot().settings.providerSettings.debugWorkspace, enabled: false } },
    });

    expect(result.switched).toBe(false);
    expect(result.message).toContain("Debug Provider");
    expect(chatStore.getMetadata()?.provider).toBe("http");
    expect(chatStore.getMessages()).toHaveLength(0);
  });

  it("supports switching from Debug back to HTTP when both are available", async () => {
    await chatStore.switchThreadProvider("debug-workspace", providerSwitchOptions());

    const result = await chatStore.switchThreadProvider("http", providerSwitchOptions());

    expect(result.switched).toBe(true);
    expect(chatStore.getMetadata()?.provider).toBe("http");
    expect(chatStore.getMessages().at(-1)?.content).toBe(
      "Provider switched from Debug Provider to HTTP.",
    );
  });

  it("blocks provider changes while generating", async () => {
    chatStore.beginTurn("turn-1");

    const result = await chatStore.switchThreadProvider("debug-workspace", providerSwitchOptions());

    expect(result.switched).toBe(false);
    expect(chatStore.getMetadata()?.provider).toBe("http");
  });
});

describe("chatStore model switching", () => {
  beforeEach(() => {
    chatStore.reset();
    resetChatProviderRegistryForTests();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    registerTestDebugWorkspaceProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: true,
    }));
    chatStore.setCapabilityChecker(createTestCapabilityChecker());
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });
  });

  it("appends a model-switched system event and updates metadata", async () => {
    const catalogs = {
      ...defaultProviderModelCatalogs,
      http: {
        modelIds: ["gpt-4o-mini", "gpt-4.1"],
        defaultModelId: "gpt-4o-mini",
      },
    };
    const result = await chatStore.switchThreadModel("gpt-4.1", {
      providerModelCatalogs: catalogs,
    });

    expect(result.switched).toBe(true);
    expect(chatStore.getMetadata()?.selectedModelId).toBe("gpt-4.1");
    expect(chatStore.getMessages().at(-1)).toMatchObject({
      role: "system",
      content: "Model switched from gpt-4o-mini to gpt-4.1.",
      systemEvent: {
        type: "model-switched",
        fromModel: "gpt-4o-mini",
        toModel: "gpt-4.1",
      },
    });
  });

  it("blocks model changes while generating", async () => {
    chatStore.beginTurn("turn-1");
    const catalogs = {
      ...defaultProviderModelCatalogs,
      http: {
        modelIds: ["gpt-4o-mini", "gpt-4.1"],
        defaultModelId: "gpt-4o-mini",
      },
    };

    const result = await chatStore.switchThreadModel("gpt-4.1", {
      providerModelCatalogs: catalogs,
    });

    expect(result.switched).toBe(false);
    expect(chatStore.getMetadata()?.selectedModelId).toBeUndefined();
  });

  it("falls back to target provider default when switching providers", async () => {
    chatStore.updateThreadMetadata({ selectedModelId: "gpt-4.1" });

    const result = await chatStore.switchThreadProvider("debug-workspace", providerSwitchOptions());

    expect(result.switched).toBe(true);
    expect(chatStore.getMetadata()?.provider).toBe("debug-workspace");
    expect(chatStore.getMetadata()?.selectedModelId).toBe("debug-simulator");
  });

  it("keeps the current model on provider switch when valid for the target provider", async () => {
    const sharedCatalogs = {
      ...defaultProviderModelCatalogs,
      http: {
        modelIds: ["shared-model", "gpt-4o-mini"],
        defaultModelId: "shared-model",
      },
      "debug-workspace": {
        modelIds: ["shared-model", "debug-simulator"],
        defaultModelId: "debug-simulator",
      },
    };

    chatStore.updateThreadMetadata({ provider: "http", selectedModelId: "shared-model" });

    const result = await chatStore.switchThreadProvider("debug-workspace", {
      providerSettings: appState.getSnapshot().settings.providerSettings,
      providerModelCatalogs: sharedCatalogs,
    });

    expect(result.switched).toBe(true);
    expect(chatStore.getMetadata()?.selectedModelId).toBe("shared-model");
  });
});

describe("chatStore active provider resolution", () => {
  beforeEach(() => {
    chatStore.reset();
    resetChatProviderRegistryForTests();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    registerTestDebugWorkspaceProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: true,
    }));
    chatStore.setCapabilityChecker(createTestCapabilityChecker());
    chatStore.setDefaultChatProviderResolver(() => "debug-workspace");
    chatStore.setActiveWorkspaceRoot("/work/a");
  });

  it("uses default provider resolver when thread metadata is missing", () => {
    expect(chatStore.getMetadata()).toBeNull();
    expect(chatStore.getActiveChatProvider()).toBe("debug-workspace");
  });

  it("preflights Debug when no thread exists yet", async () => {
    const result = await chatStore.runAccessPreflight();

    expect(result.status).toBe("ready");
    expect(result.message).toContain("Debug Agent provider is ready");
  });

  it("checks capabilities for Debug without persisted thread metadata", async () => {
    const result = await chatStore.checkActiveWorkspaceCapabilities();

    expect(result.status).toBe("ready");
    expect(result.capabilities?.supportedModes).toEqual(["ask", "review"]);
  });
});
