import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatStore } from "./chatStore";
import {
  buildThreadPromptContext,
  countConversationTurns,
  setChatRetentionMaxTurnsForTests,
} from "../services/chatRetention";
import {
  deleteAgentPersistence,
  readAgentThreadFileSnapshot,
  readWorkspaceAgentsIndexSnapshot,
} from "../services/chatPersistence";

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

const deleteAgentPersistenceMock = vi.mocked(deleteAgentPersistence);

describe("M4 milestone validation", () => {
  beforeEach(() => {
    chatStore.reset();
    chatStore.setCapabilityChecker(null);
    setChatRetentionMaxTurnsForTests(undefined);
    deleteAgentPersistenceMock.mockReset();
    deleteAgentPersistenceMock.mockResolvedValue(undefined);
    vi.mocked(readAgentThreadFileSnapshot).mockReset();
  });

  it("keeps long-running usage bounded via FIFO cap overflow", () => {
    setChatRetentionMaxTurnsForTests(3);
    chatStore.setActiveWorkspaceRoot("/work/a");

    for (let index = 1; index <= 12; index += 1) {
      chatStore.appendMessage({
        id: `u-${index}`,
        role: "user",
        content: `question-${index}`,
        createdAt: `2026-05-26T00:00:${String(index).padStart(2, "0")}.000Z`,
      });
      chatStore.appendMessage({
        id: `a-${index}`,
        role: "assistant",
        content: `answer-${index}`,
        createdAt: `2026-05-26T00:01:${String(index).padStart(2, "0")}.000Z`,
      });
    }

    const messages = chatStore.getMessages();
    expect(countConversationTurns(messages)).toBeLessThanOrEqual(3);
    expect(messages.at(-1)?.content).toBe("answer-12");
  });

  it("updates compaction summary and metadata when old turns are removed", () => {
    setChatRetentionMaxTurnsForTests(1);
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "u-1",
      role: "user",
      content: "first question",
      createdAt: "2026-05-26T00:00:01.000Z",
    });
    chatStore.appendMessage({
      id: "a-1",
      role: "assistant",
      content: "first answer",
      createdAt: "2026-05-26T00:00:02.000Z",
    });
    chatStore.appendMessage({
      id: "u-2",
      role: "user",
      content: "second question",
      createdAt: "2026-05-26T00:00:03.000Z",
    });

    const metadata = chatStore.getMetadata();
    expect(metadata?.summary).toContain("- User: first question");
    expect(metadata?.summary).toContain("- Assistant: first answer");
    expect(metadata?.compactedMessageCount).toBeGreaterThan(0);
    expect(metadata?.compactionCount).toBeGreaterThan(0);
    expect(metadata?.lastCompactedAt).toBeDefined();
  });

  it("exposes prompt context with summary plus recent turns after compaction", () => {
    setChatRetentionMaxTurnsForTests(1);
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "u-1",
      role: "user",
      content: "old question",
      createdAt: "2026-05-26T00:00:01.000Z",
    });
    chatStore.appendMessage({
      id: "u-2",
      role: "user",
      content: "recent question",
      createdAt: "2026-05-26T00:00:02.000Z",
    });

    const thread = chatStore.getActiveThreadSnapshot();
    expect(thread).not.toBeNull();
    const context = buildThreadPromptContext(thread!);

    expect(context.summary).toContain("- User: old question");
    expect(context.recentMessages.map((message) => message.id)).toEqual(["u-2"]);
  });

  it("clears active workspace history and resets compaction metadata", async () => {
    setChatRetentionMaxTurnsForTests(1);
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "u-1",
      role: "user",
      content: "one",
      createdAt: "2026-05-26T00:00:01.000Z",
    });
    chatStore.appendMessage({
      id: "u-2",
      role: "user",
      content: "two",
      createdAt: "2026-05-26T00:00:02.000Z",
    });
    expect(chatStore.getMetadata()?.compactedMessageCount).toBeGreaterThan(0);

    await chatStore.clearActiveWorkspaceChatHistory();

    expect(chatStore.hasThread()).toBe(false);
    expect(chatStore.isEmpty()).toBe(true);
    expect(deleteAgentPersistenceMock).toHaveBeenCalledWith("/work/a", "agent-1");
  });

  it("isolates clear history to the active workspace", async () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.setAgentThread("agent-a", {
      metadata: {
        agentId: "agent-a",
        threadId: "agent-a",
        mode: "ask",
        provider: "glm",
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
        compactedMessageCount: 5,
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
        compactedMessageCount: 2,
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
    expect(workspace?.threadsByAgentId["agent-b"]?.metadata.compactedMessageCount).toBe(2);
  });

  it("provides retry scaffolding without provider coupling", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "u-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-26T00:00:00.000Z",
    });

    expect(chatStore.beginTurn("u-1")).toBe(true);
    expect(chatStore.getRuntimeState().isGenerating).toBe(true);
    expect(chatStore.failTurn({ message: "Provider unavailable" })).toBe(true);
    expect(chatStore.canRetryLastTurn()).toBe(true);
    expect(chatStore.completeTurn()).toBe(false);
  });
});
