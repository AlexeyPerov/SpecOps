import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatStore, resetAgentIdCounterForTests } from "../chatStore";
import { setChatRetentionMaxTurnsForTests } from "../../services/chatRetention";

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

describe("chatStore thread message mutators", () => {
  beforeEach(() => {
    chatStore.reset();
    resetAgentIdCounterForTests();
    setChatRetentionMaxTurnsForTests(undefined);
  });

  function seedThreadWithMessages() {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "u-1",
      role: "user",
      content: "hello",
      createdAt: "2026-06-07T00:00:00.000Z",
    });
    chatStore.appendMessage({
      id: "a-1",
      role: "assistant",
      content: "original reply",
      createdAt: "2026-06-07T00:00:01.000Z",
    });
  }

  describe("updateMessageContent", () => {
    it("updates an assistant message in place", () => {
      seedThreadWithMessages();

      const updated = chatStore.updateMessageContent("a-1", "revised reply");

      expect(updated).toBe(true);
      expect(chatStore.getMessages().find((message) => message.id === "a-1")?.content).toBe(
        "revised reply",
      );
      expect(chatStore.getMetadata()?.updatedAt).toBeDefined();
    });

    it("returns false when the message id is missing", () => {
      seedThreadWithMessages();

      expect(chatStore.updateMessageContent("missing-id", "ignored")).toBe(false);
      expect(chatStore.getMessages()).toHaveLength(2);
    });
  });

  describe("removeMessage", () => {
    it("removes a message by id", () => {
      seedThreadWithMessages();

      const removed = chatStore.removeMessage("a-1");

      expect(removed).toBe(true);
      expect(chatStore.getMessages().map((message) => message.id)).toEqual(["u-1"]);
    });

    it("returns false when the message id is missing", () => {
      seedThreadWithMessages();

      expect(chatStore.removeMessage("missing-id")).toBe(false);
      expect(chatStore.getMessages()).toHaveLength(2);
    });
  });

  describe("compactActiveThread", () => {
    it("compacts the active thread when it exceeds the retention threshold", () => {
      setChatRetentionMaxTurnsForTests(2);
      chatStore.setActiveWorkspaceRoot("/work/a");

      for (let index = 1; index <= 3; index += 1) {
        chatStore.appendMessage(
          {
            id: `u-${index}`,
            role: "user",
            content: `turn-${index}`,
            createdAt: `2026-06-07T00:00:0${index}.000Z`,
          },
          { skipCompaction: true },
        );
        chatStore.appendMessage(
          {
            id: `a-${index}`,
            role: "assistant",
            content: `reply-${index}`,
            createdAt: `2026-06-07T00:00:1${index}.000Z`,
          },
          { skipCompaction: true },
        );
      }

      expect(chatStore.getMessages()).toHaveLength(6);

      const compacted = chatStore.compactActiveThread();

      expect(compacted).toBe(true);
      expect(chatStore.getMessages().map((message) => message.id)).toEqual([
        "u-2",
        "a-2",
        "u-3",
        "a-3",
      ]);
      expect(chatStore.getMetadata()).toMatchObject({
        compactionCount: 1,
        compactedMessageCount: 2,
      });
    });
  });
});
