import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatStore } from "./chatStore";
import type { ChatThreadFileSnapshot } from "../domain/contracts";
import { WorkspaceAccessReason, type CapabilityChecker } from "../ai/capabilities";
import { readWorkspaceChatFileSnapshot } from "../services/chatPersistence";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";

vi.mock("../services/chatPersistence", () => ({
  readWorkspaceChatFileSnapshot: vi.fn(),
}));

vi.mock("../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
}));

const readWorkspaceChatFileSnapshotMock = vi.mocked(readWorkspaceChatFileSnapshot);
const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);

describe("chatStore", () => {
  beforeEach(() => {
    chatStore.reset();
    chatStore.setCapabilityChecker(null);
    readWorkspaceChatFileSnapshotMock.mockReset();
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
});
