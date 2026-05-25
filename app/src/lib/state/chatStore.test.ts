import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatStore } from "./chatStore";
import type { ChatThreadFileSnapshot } from "../domain/contracts";
import { readWorkspaceChatFileSnapshot } from "../services/chatPersistence";

vi.mock("../services/chatPersistence", () => ({
  readWorkspaceChatFileSnapshot: vi.fn(),
}));

const readWorkspaceChatFileSnapshotMock = vi.mocked(readWorkspaceChatFileSnapshot);

describe("chatStore", () => {
  beforeEach(() => {
    chatStore.reset();
    readWorkspaceChatFileSnapshotMock.mockReset();
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
      mode: "review",
      provider: "cursor",
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:02.000Z",
      summary: "brief summary",
    });
  });

  it("switches active thread state by workspace key", async () => {
    const workspaceA: ChatThreadFileSnapshot = {
      version: 1,
      thread: {
        metadata: {
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
      },
    };

    const workspaceB: ChatThreadFileSnapshot = {
      version: 1,
      thread: {
        metadata: {
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
      },
    };

    readWorkspaceChatFileSnapshotMock
      .mockResolvedValueOnce(workspaceA)
      .mockResolvedValueOnce(workspaceB)
      .mockResolvedValueOnce(workspaceA);

    chatStore.setActiveWorkspaceRoot("/work/a");
    await chatStore.loadWorkspaceThread("/work/a");
    expect(chatStore.getMessages().map((message) => message.id)).toEqual(["a-1"]);
    expect(chatStore.getMetadata()?.mode).toBe("ask");

    chatStore.setActiveWorkspaceRoot("/work/b");
    await chatStore.loadWorkspaceThread("/work/b");
    expect(chatStore.getMessages().map((message) => message.id)).toEqual(["b-1"]);
    expect(chatStore.getMetadata()?.mode).toBe("review");

    chatStore.setActiveWorkspaceRoot("/work/a");
    await chatStore.loadWorkspaceThread("/work/a");
    expect(chatStore.getMessages().map((message) => message.id)).toEqual(["a-1"]);
    expect(chatStore.getMetadata()?.provider).toBe("glm");
  });

  it("shows empty state when workspace has no persisted thread", async () => {
    readWorkspaceChatFileSnapshotMock.mockResolvedValue({
      version: 1,
      thread: null,
    });

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
});
