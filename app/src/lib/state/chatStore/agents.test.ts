import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_HTTP_CONTEXT_ID } from "../../domain/contracts";
import { chatStore, formatCompactionNotice, resetAgentIdCounterForTests } from "../chatStore";
import { DRAFT_AGENT_TITLE } from "../../services/chatAgents";
import type { ChatThreadSnapshot } from "../../domain/contracts";
import { WorkspaceAccessReason, type CapabilityChecker } from "../../ai/capabilities";
import {
  WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
  WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
} from "../../ai/chatErrorCopy";
import {
  deleteAgentPersistence,
  readAgentThreadFileSnapshot,
  readWorkspaceAgentsIndexSnapshot,
} from "../../services/chatPersistence";
import { setChatRetentionMaxTurnsForTests } from "../../services/chatRetention";
import { ensureWorkspaceReadAccess } from "../../services/fileSystem";
import { defaultAppProviderSettings } from "../../ai/providers/appProviderSettings";
import {
  createTestCapabilityChecker,
  registerTestDebugWorkspaceProvider,
} from "../../ai/providers/debugProviderTestHelpers";
import { appState } from "../appState";
import { defaultDebugProviderSettings } from "../../ai/providers/debugProviderSettings";
import { defaultHttpConnectionSettings, DEFAULT_HTTP_CONNECTION_ID } from "../../ai/providers/httpConnectionSettings";
import { defaultProviderModelCatalogs } from "../../ai/providers/providerModelCatalog";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "../../ai/providers/registry";

vi.mock("../../services/chatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/chatPersistence")>();
  return {
    ...actual,
    readAgentThreadFileSnapshot: vi.fn(),
    readWorkspaceAgentsIndexSnapshot: vi.fn(),
    deleteAgentPersistence: vi.fn(),
  };
});

vi.mock("../../services/fileSystem", () => ({
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

  it("stores and clears opencode session mapping per workspace agent", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    const agentId = chatStore.createDraftAgent();
    expect(agentId).toBe("agent-1");

    expect(chatStore.setAgentSessionLink(agentId!, { opencodeSessionId: "sess-1" })).toBe(true);
    expect(chatStore.getAgentSessionLink(agentId!)).toEqual({
      opencodeSessionId: "sess-1",
      opencodeModelId: undefined,
      opencodeProviderId: undefined,
    });

    expect(
      chatStore.setAgentSessionLink(agentId!, {
        opencodeSessionId: "sess-1",
        opencodeModelId: "gpt-4o-mini",
        opencodeProviderId: "opencode",
      }),
    ).toBe(true);
    expect(chatStore.getAgentSessionLink(agentId!)).toEqual({
      opencodeSessionId: "sess-1",
      opencodeModelId: "gpt-4o-mini",
      opencodeProviderId: "opencode",
    });

    expect(chatStore.clearAgentSessionLink(agentId!)).toBe(true);
    expect(chatStore.getAgentSessionLink(agentId!)).toBeNull();
  });

  it("keeps opencode session mapping isolated per workspace root", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    const agentA = chatStore.createDraftAgent();
    chatStore.setAgentSessionLink(agentA!, { opencodeSessionId: "sess-a" });

    chatStore.setActiveWorkspaceRoot("/work/b");
    const agentB = chatStore.createDraftAgent();
    chatStore.setAgentSessionLink(agentB!, { opencodeSessionId: "sess-b" });

    expect(chatStore.getAgentSessionLink(agentB!)).toEqual({
      opencodeSessionId: "sess-b",
      opencodeModelId: undefined,
      opencodeProviderId: undefined,
    });
    expect(chatStore.getAgentSessionLink(agentA!, "/work/a")).toEqual({
      opencodeSessionId: "sess-a",
      opencodeModelId: undefined,
      opencodeProviderId: undefined,
    });
  });
});
