import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatStore, formatCompactionNotice, resetAgentIdCounterForTests } from "./chatStore";
import type { ChatThreadSnapshot } from "../domain/contracts";
import { WorkspaceAccessReason, type CapabilityChecker } from "../ai/capabilities";
import {
  deleteAgentPersistence,
  readAgentThreadFileSnapshot,
  readWorkspaceAgentsIndexSnapshot,
} from "../services/chatPersistence";
import { setChatRetentionMaxTurnsForTests } from "../services/chatRetention";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";
import { createDebugChatProvider } from "../ai/providers/debugChatProvider";
import { createRegistryCapabilityChecker } from "../ai/providers/capabilityChecker";
import { defaultDebugProviderSettings } from "../ai/providers/debugProviderSettings";
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
      provider: "glm",
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
      { mode: "review", provider: "cursor", summary: "brief summary" },
      "2026-05-25T00:00:02.000Z",
    );

    expect(appended).toBe(true);
    expect(metadataUpdated).toBe(true);
    expect(chatStore.getMessages().map((message) => message.id)).toEqual(["m-1", "m-2"]);
    expect(chatStore.getMetadata()).toEqual({
      agentId: "agent-1",
      threadId: "agent-1",
      mode: "review",
      provider: "cursor",
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
      provider: "glm",
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
      provider: "glm",
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
        provider: "glm",
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
        provider: "cursor",
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
    expect(chatStore.getMetadata()?.provider).toBe("cursor");
  });

  it("loads workspace agents from index and thread files", async () => {
    const threadA: ChatThreadSnapshot = {
      metadata: {
        agentId: "agent-a",
        threadId: "agent-a",
        mode: "ask",
        provider: "glm",
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

    expect(chatStore.getActiveAgentId()).toBe("agent-a");
    expect(chatStore.getMessages()).toEqual(threadA.messages);
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
      provider: "glm",
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
      message: "AI cannot read files in this workspace because the path is inaccessible.",
      recoveryHint: "Re-open the workspace path and confirm file permissions.",
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
        provider: "glm",
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
        provider: "cursor",
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
    chatStore.updateThreadMetadata({ mode: "ask", provider: "glm" }, "2026-05-26T00:00:00.000Z", "agent-a");
    chatStore.updateThreadMetadata({ mode: "ask", provider: "glm" }, "2026-05-26T00:00:00.000Z", "agent-b");

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

  it("clears retry runtime state when chat history is cleared", async () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
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
    expect(formatCompactionNotice(1)).toBe("1 older message compacted");
    expect(formatCompactionNotice(24)).toBe("24 older messages compacted");
  });
});

describe("chatStore provider switching", () => {
  beforeEach(() => {
    chatStore.reset();
    resetChatProviderRegistryForTests();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    registerChatProvider(
      createDebugChatProvider(() => ({
        ...defaultDebugProviderSettings,
        enabled: true,
      })),
    );
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(() => ({
        ...defaultDebugProviderSettings,
        enabled: true,
      })),
    );
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.updateThreadMetadata({ provider: "glm", mode: "ask" });
  });

  it("appends a provider-switched system event and updates metadata", async () => {
    const result = await chatStore.switchThreadProvider("debug", { debugProviderEnabled: true });

    expect(result.switched).toBe(true);
    expect(chatStore.getMetadata()?.provider).toBe("debug");
    expect(chatStore.getMessages().at(-1)).toMatchObject({
      role: "system",
      content: "Provider switched from GLM to Debug.",
      systemEvent: {
        type: "provider-switched",
        fromProvider: "glm",
        toProvider: "debug",
      },
    });
  });

  it("blocks switching to Debug when it is disabled in settings", async () => {
    const result = await chatStore.switchThreadProvider("debug", { debugProviderEnabled: false });

    expect(result.switched).toBe(false);
    expect(result.message).toContain("Developer Settings");
    expect(chatStore.getMetadata()?.provider).toBe("glm");
    expect(chatStore.getMessages()).toHaveLength(0);
  });

  it("supports switching from Debug back to GLM when both are available", async () => {
    await chatStore.switchThreadProvider("debug", { debugProviderEnabled: true });

    const result = await chatStore.switchThreadProvider("glm", { debugProviderEnabled: true });

    expect(result.switched).toBe(true);
    expect(chatStore.getMetadata()?.provider).toBe("glm");
    expect(chatStore.getMessages().at(-1)?.content).toBe("Provider switched from Debug to GLM.");
  });

  it("blocks provider changes while generating", async () => {
    chatStore.beginTurn("turn-1");

    const result = await chatStore.switchThreadProvider("debug", { debugProviderEnabled: true });

    expect(result.switched).toBe(false);
    expect(chatStore.getMetadata()?.provider).toBe("glm");
  });
});

describe("chatStore active provider resolution", () => {
  beforeEach(() => {
    chatStore.reset();
    resetChatProviderRegistryForTests();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    registerChatProvider(
      createDebugChatProvider(() => ({
        ...defaultDebugProviderSettings,
        enabled: true,
      })),
    );
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(() => ({
        ...defaultDebugProviderSettings,
        enabled: true,
      })),
    );
    chatStore.setDefaultChatProviderResolver(() => "debug");
    chatStore.setActiveWorkspaceRoot("/work/a");
  });

  it("uses default provider resolver when thread metadata is missing", () => {
    expect(chatStore.getMetadata()).toBeNull();
    expect(chatStore.getActiveChatProvider()).toBe("debug");
  });

  it("preflights Debug when no thread exists yet", async () => {
    const result = await chatStore.runAccessPreflight();

    expect(result.status).toBe("ready");
    expect(result.message).toContain("Debug provider is ready");
  });

  it("checks capabilities for Debug without persisted thread metadata", async () => {
    const result = await chatStore.checkActiveWorkspaceCapabilities();

    expect(result.status).toBe("ready");
    expect(result.capabilities?.supportedModes).toEqual(["ask", "review"]);
  });
});
