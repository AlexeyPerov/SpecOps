import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_HTTP_CONTEXT_ID } from "../../domain/contracts";
import { chatStore, formatCompactionNotice, resetSessionIdCounterForTests } from "../chatStore";
import { DRAFT_SESSION_TITLE } from "../../services/chatSessions";
import type { ChatThreadSnapshot } from "../../domain/contracts";
import { WorkspaceAccessReason, type CapabilityChecker } from "../../ai/capabilities";
import {
  WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
  WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
} from "../../ai/chatErrorCopy";
import {
  deleteSessionPersistence,
  readSessionThreadFileSnapshot,
  readWorkspaceSessionsIndexSnapshot,
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
    readSessionThreadFileSnapshot: vi.fn(),
    readWorkspaceSessionsIndexSnapshot: vi.fn(),
    deleteSessionPersistence: vi.fn(),
  };
});

vi.mock("../../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
}));

const readSessionThreadFileSnapshotMock = vi.mocked(readSessionThreadFileSnapshot);
const readWorkspaceSessionsIndexSnapshotMock = vi.mocked(readWorkspaceSessionsIndexSnapshot);
const deleteSessionPersistenceMock = vi.mocked(deleteSessionPersistence);
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
    resetSessionIdCounterForTests();
    readSessionThreadFileSnapshotMock.mockReset();
    readWorkspaceSessionsIndexSnapshotMock.mockReset();
    readWorkspaceSessionsIndexSnapshotMock.mockResolvedValue({ version: 1, sessions: [] });
    deleteSessionPersistenceMock.mockReset();
    deleteSessionPersistenceMock.mockResolvedValue(undefined);
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
      sessionId: "session-1",
      threadId: "session-1",
      mode: "ask",
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
      sessionId: "session-1",
      threadId: "session-1",
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
      sessionId: "session-1",
      threadId: "session-1",
      mode: "review",
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
      createdAt: "2026-05-26T00:00:01.000Z",
      compactionCount: 2,
      compactedMessageCount: 4,
    });
    expect(chatStore.getMetadata()?.lastCompactedAt).toBeDefined();
  });

  it("switches active thread state when changing active agent", () => {
    const threadA: ChatThreadSnapshot = {
      metadata: {
        sessionId: "agent-a",
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
        sessionId: "agent-b",
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
    chatStore.setSessionThread("agent-a", threadA);
    chatStore.setSessionThread("agent-b", threadB);
    chatStore.setActiveSessionId("agent-a");
    expect(chatStore.getMessages().map((message) => message.id)).toEqual(["a-1"]);
    expect(chatStore.getMetadata()?.mode).toBe("ask");

    chatStore.setActiveSessionId("agent-b");
    expect(chatStore.getMessages().map((message) => message.id)).toEqual(["b-1"]);
    expect(chatStore.getMetadata()?.mode).toBe("review");
    expect(chatStore.getMetadata()?.provider).toBe("debug-workspace");
  });

  it("loads workspace agents from index and thread files", async () => {
    const threadA: ChatThreadSnapshot = {
      metadata: {
        sessionId: "agent-a",
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

    readWorkspaceSessionsIndexSnapshotMock.mockResolvedValue({
      version: 1,
      sessions: [{ id: "agent-a", title: "A", lastUsedAt: "2026-05-25T00:00:00.000Z" }],
    });
    readSessionThreadFileSnapshotMock.mockResolvedValue(threadA);

    chatStore.setActiveWorkspaceRoot("/work/a");
    await chatStore.loadWorkspaceSessions("/work/a");

    expect(chatStore.getActiveSessionId()).toBeNull();
    chatStore.setActiveSessionId("agent-a");
    expect(chatStore.getMessages()).toEqual(threadA.messages);
  });

  it("hydrates priority sessions first and defers the rest in background", async () => {
    const threadA: ChatThreadSnapshot = {
      metadata: {
        sessionId: "agent-a",
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
        sessionId: "agent-b",
        threadId: "agent-b",
        mode: "ask",
        provider: "http",
        createdAt: "2026-05-25T00:00:01.000Z",
        updatedAt: "2026-05-25T00:00:01.000Z",
      },
      messages: [
        {
          id: "b-1",
          role: "user",
          content: "B",
          createdAt: "2026-05-25T00:00:01.000Z",
        },
      ],
    };

    readWorkspaceSessionsIndexSnapshotMock.mockResolvedValue({
      version: 1,
      sessions: [
        { id: "agent-a", title: "A", lastUsedAt: "2026-05-25T00:00:00.000Z" },
        { id: "agent-b", title: "B", lastUsedAt: "2026-05-25T00:00:01.000Z" },
      ],
    });
    readSessionThreadFileSnapshotMock.mockImplementation(async (_root, sessionId) => {
      if (sessionId === "agent-a") {
        return threadA;
      }
      if (sessionId === "agent-b") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return threadB;
      }
      return null;
    });

    chatStore.setActiveWorkspaceRoot("/work/a");
    await chatStore.loadWorkspaceSessions("/work/a", { prioritySessionIds: ["agent-a"] });

    expect(chatStore.getSessionIndex().map((entry) => entry.id)).toEqual(["agent-a", "agent-b"]);
    expect(chatStore.isSessionThreadHydrated("agent-a")).toBe(true);
    expect(chatStore.isSessionThreadHydrated("agent-b")).toBe(false);
    chatStore.setActiveSessionId("agent-a");
    expect(chatStore.getMessages()).toEqual(threadA.messages);

    await vi.waitFor(() => {
      expect(chatStore.isSessionThreadHydrated("agent-b")).toBe(true);
    });
    chatStore.setActiveSessionId("agent-b");
    expect(chatStore.getMessages()).toEqual(threadB.messages);
  });

  it("ensureSessionThreadHydrated loads a deferred thread on demand", async () => {
    const threadB: ChatThreadSnapshot = {
      metadata: {
        sessionId: "agent-b",
        threadId: "agent-b",
        mode: "ask",
        provider: "http",
        createdAt: "2026-05-25T00:00:01.000Z",
        updatedAt: "2026-05-25T00:00:01.000Z",
      },
      messages: [
        {
          id: "b-1",
          role: "user",
          content: "B",
          createdAt: "2026-05-25T00:00:01.000Z",
        },
      ],
    };
    let releaseB!: () => void;
    const bGate = new Promise<void>((resolve) => {
      releaseB = resolve;
    });

    readWorkspaceSessionsIndexSnapshotMock.mockResolvedValue({
      version: 1,
      sessions: [
        { id: "agent-a", title: "A", lastUsedAt: "2026-05-25T00:00:00.000Z" },
        { id: "agent-b", title: "B", lastUsedAt: "2026-05-25T00:00:01.000Z" },
      ],
    });
    readSessionThreadFileSnapshotMock.mockImplementation(async (_root, sessionId) => {
      if (sessionId === "agent-b") {
        await bGate;
        return threadB;
      }
      return null;
    });

    chatStore.setActiveWorkspaceRoot("/work/a");
    await chatStore.loadWorkspaceSessions("/work/a", { prioritySessionIds: ["agent-a"] });
    expect(chatStore.isSessionThreadHydrated("agent-b")).toBe(false);

    const ensurePromise = chatStore.ensureSessionThreadHydrated("agent-b");
    releaseB();
    const hydrated = await ensurePromise;
    expect(hydrated?.messages).toEqual(threadB.messages);
    expect(chatStore.isSessionThreadHydrated("agent-b")).toBe(true);
    chatStore.setActiveSessionId("agent-b");
    expect(chatStore.getMessages()).toEqual(threadB.messages);
  });

  it("preserves in-memory draft sessions across incremental load", async () => {
    readWorkspaceSessionsIndexSnapshotMock.mockResolvedValue({
      version: 1,
      sessions: [{ id: "agent-a", title: "A", lastUsedAt: "2026-05-25T00:00:00.000Z" }],
    });
    readSessionThreadFileSnapshotMock.mockResolvedValue(null);

    chatStore.setActiveWorkspaceRoot("/work/a");
    const draftId = chatStore.createDraftSession();
    expect(draftId).toBeTruthy();

    await chatStore.loadWorkspaceSessions("/work/a", { prioritySessionIds: ["agent-a"] });

    expect(chatStore.getActiveSessionId()).toBe(draftId);
    expect(chatStore.getSessionIndex().some((entry) => entry.id === draftId && entry.isDraft)).toBe(
      true,
    );
    expect(chatStore.getSessionIndex().some((entry) => entry.id === "agent-a")).toBe(true);
  });

  it("mergeSessionDrafts adds draft entries for open tab ids missing from disk index", async () => {
    readWorkspaceSessionsIndexSnapshotMock.mockResolvedValue({
      version: 1,
      sessions: [{ id: "agent-a", title: "A", lastUsedAt: "2026-05-25T00:00:00.000Z" }],
    });
    readSessionThreadFileSnapshotMock.mockResolvedValue(null);

    chatStore.setActiveWorkspaceRoot("/work/a");
    await chatStore.loadWorkspaceSessions("/work/a");
    chatStore.mergeSessionDrafts("/work/a", ["agent-draft-tab"]);

    const index = chatStore.getSessionIndex();
    expect(index.some((entry) => entry.id === "agent-draft-tab" && entry.isDraft)).toBe(true);
    expect(index.some((entry) => entry.id === "agent-a")).toBe(true);
  });

  it("loadWorkspaceSessions skips disk re-reads when in-memory cache is current", async () => {
    const threadA: ChatThreadSnapshot = {
      metadata: {
        sessionId: "agent-a",
        threadId: "agent-a",
        mode: "ask",
        provider: "http",
        createdAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      messages: [
        { id: "a-1", role: "user", content: "A", createdAt: "2026-05-25T00:00:00.000Z" },
      ],
    };
    const threadB: ChatThreadSnapshot = {
      metadata: {
        sessionId: "agent-b",
        threadId: "agent-b",
        mode: "ask",
        provider: "http",
        createdAt: "2026-05-25T00:00:01.000Z",
        updatedAt: "2026-05-25T00:00:01.000Z",
      },
      messages: [
        { id: "b-1", role: "user", content: "B", createdAt: "2026-05-25T00:00:01.000Z" },
      ],
    };
    const indexSnapshot = {
      version: 1 as const,
      sessions: [
        { id: "agent-a", title: "A", lastUsedAt: "2026-05-25T00:00:00.000Z" },
        { id: "agent-b", title: "B", lastUsedAt: "2026-05-25T00:00:01.000Z" },
      ],
    };
    readWorkspaceSessionsIndexSnapshotMock.mockResolvedValue(indexSnapshot);
    readSessionThreadFileSnapshotMock.mockImplementation(async (_root, sessionId) => {
      if (sessionId === "agent-a") return threadA;
      if (sessionId === "agent-b") return threadB;
      return null;
    });

    chatStore.setActiveWorkspaceRoot("/work/cache");
    await chatStore.loadWorkspaceSessions("/work/cache");
    expect(readSessionThreadFileSnapshotMock).toHaveBeenCalledTimes(2);

    readSessionThreadFileSnapshotMock.mockClear();
    // Re-enter the same workspace: the on-disk index is unchanged, every
    // persisted session already has its thread in memory — no disk reads.
    await chatStore.loadWorkspaceSessions("/work/cache");
    expect(readSessionThreadFileSnapshotMock).not.toHaveBeenCalled();
    // Threads are still in memory.
    chatStore.setActiveSessionId("agent-a");
    expect(chatStore.getMessages()).toEqual(threadA.messages);
  });

  it("loadWorkspaceSessions re-reads only missing threads when a new session appears", async () => {
    const threadA: ChatThreadSnapshot = {
      metadata: {
        sessionId: "agent-a",
        threadId: "agent-a",
        mode: "ask",
        provider: "http",
        createdAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      messages: [
        { id: "a-1", role: "user", content: "A", createdAt: "2026-05-25T00:00:00.000Z" },
      ],
    };
    const threadB: ChatThreadSnapshot = {
      metadata: {
        sessionId: "agent-b",
        threadId: "agent-b",
        mode: "ask",
        provider: "http",
        createdAt: "2026-05-25T00:00:01.000Z",
        updatedAt: "2026-05-25T00:00:01.000Z",
      },
      messages: [
        { id: "b-1", role: "user", content: "B", createdAt: "2026-05-25T00:00:01.000Z" },
      ],
    };
    readWorkspaceSessionsIndexSnapshotMock.mockResolvedValue({
      version: 1,
      sessions: [{ id: "agent-a", title: "A", lastUsedAt: "2026-05-25T00:00:00.000Z" }],
    });
    readSessionThreadFileSnapshotMock.mockImplementation(async (_root, sessionId) => {
      if (sessionId === "agent-a") return threadA;
      if (sessionId === "agent-b") return threadB;
      return null;
    });

    chatStore.setActiveWorkspaceRoot("/work/delta");
    await chatStore.loadWorkspaceSessions("/work/delta");
    expect(readSessionThreadFileSnapshotMock).toHaveBeenCalledTimes(1);

    readSessionThreadFileSnapshotMock.mockClear();
    // The on-disk index now includes a new session — only the new one should
    // be read from disk; agent-a stays cached in memory.
    readWorkspaceSessionsIndexSnapshotMock.mockResolvedValue({
      version: 1,
      sessions: [
        { id: "agent-a", title: "A", lastUsedAt: "2026-05-25T00:00:00.000Z" },
        { id: "agent-b", title: "B", lastUsedAt: "2026-05-25T00:00:01.000Z" },
      ],
    });
    await chatStore.loadWorkspaceSessions("/work/delta");
    expect(readSessionThreadFileSnapshotMock).toHaveBeenCalledTimes(1);
    expect(readSessionThreadFileSnapshotMock).toHaveBeenCalledWith("/work/delta", "agent-b");
    chatStore.setActiveSessionId("agent-a");
    expect(chatStore.getMessages()).toEqual(threadA.messages);
    chatStore.setActiveSessionId("agent-b");
    expect(chatStore.getMessages()).toEqual(threadB.messages);
  });

  it("shows empty state when workspace has no persisted thread", async () => {
    readSessionThreadFileSnapshotMock.mockResolvedValue(null);

    chatStore.setActiveWorkspaceRoot("/work/empty");
    await chatStore.loadWorkspaceThread("/work/empty");

    expect(chatStore.hasThread()).toBe(false);
    expect(chatStore.isEmpty()).toBe(true);
    expect(chatStore.getMessages()).toEqual([]);
    expect(chatStore.getMetadata()).toBeNull();
  });

  it("preserves in-memory session draft agents when disk index is empty", async () => {
    readWorkspaceSessionsIndexSnapshotMock.mockResolvedValue({
      version: 1,
      sessions: [],
    });

    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    const draftId = chatStore.createDraftSession();
    expect(draftId).toBeTruthy();

    await chatStore.loadWorkspaceSessions(CHAT_HTTP_CONTEXT_ID);

    expect(chatStore.getActiveSessionId()).toBe(draftId);
    expect(chatStore.getSessionIndex().some((entry) => entry.id === draftId && entry.isDraft)).toBe(
      true,
    );
  });

  it("scopes chat-http agents separately from workspace agents", async () => {
    const workspaceIndex = {
      version: 1 as const,
      sessions: [{ id: "ws-agent", title: "Workspace", lastUsedAt: "2026-06-05T00:00:00.000Z" }],
    };
    const chatHttpIndex = {
      version: 1 as const,
      sessions: [{ id: "http-agent", title: "Chat HTTP", lastUsedAt: "2026-06-05T00:00:01.000Z" }],
    };

    readWorkspaceSessionsIndexSnapshotMock.mockImplementation(async (scopeKey: string) => {
      if (scopeKey === CHAT_HTTP_CONTEXT_ID) {
        return chatHttpIndex;
      }
      return workspaceIndex;
    });

    chatStore.setActiveWorkspaceRoot("/work/a");
    await chatStore.loadWorkspaceSessions("/work/a");
    expect(chatStore.getSessionIndex().map((entry) => entry.id)).toEqual(["ws-agent"]);

    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    await chatStore.loadWorkspaceSessions(CHAT_HTTP_CONTEXT_ID);
    expect(chatStore.getActiveChatScopeKey()).toBe(CHAT_HTTP_CONTEXT_ID);
    expect(chatStore.getActiveWorkspaceRoot()).toBeNull();
    expect(chatStore.getSessionIndex().map((entry) => entry.id)).toEqual(["http-agent"]);

    chatStore.setActiveWorkspaceRoot("/work/a");
    expect(chatStore.getSessionIndex().map((entry) => entry.id)).toEqual(["ws-agent"]);
  });

  it("keeps persisted chat-http review mode threads unchanged on load", async () => {
    const chatHttpThread: ChatThreadSnapshot = {
      metadata: {
        sessionId: "http-agent",
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

    readWorkspaceSessionsIndexSnapshotMock.mockResolvedValue({
      version: 1,
      sessions: [{ id: "http-agent", title: "Chat HTTP", lastUsedAt: "2026-06-05T00:00:01.000Z" }],
    });
    readSessionThreadFileSnapshotMock.mockResolvedValue(chatHttpThread);

    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    await chatStore.loadWorkspaceSessions(CHAT_HTTP_CONTEXT_ID);
    chatStore.setActiveSessionId("http-agent");

    expect(chatStore.getMetadata()?.mode).toBe("review");
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
    chatStore.updateThreadMetadata({ provider: "http" });

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
    chatStore.updateThreadMetadata({ provider: "http" });

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

  it("updates message parts via updateMessageParts", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "m-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-25T00:00:00.000Z",
    });
    chatStore.appendMessage({
      id: "m-2",
      role: "assistant",
      content: "",
      createdAt: "2026-05-25T00:00:01.000Z",
    });

    const parts = [
      { type: "reasoning" as const, text: "Thinking..." },
      { type: "text" as const, text: "Answer." },
    ];
    const updated = chatStore.updateMessageParts("m-2", parts);

    expect(updated).toBe(true);
    const messages = chatStore.getMessages();
    expect(messages[1]?.parts).toEqual(parts);
    expect(messages[1]?.content).toBe("");
  });

  it("returns false when updateMessageParts targets a missing message", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "m-1",
      role: "user",
      content: "hello",
      createdAt: "2026-05-25T00:00:00.000Z",
    });

    const updated = chatStore.updateMessageParts("nope", [
      { type: "text", text: "x" },
    ]);
    expect(updated).toBe(false);
  });

  it("setThreadMessages replaces the message list (workspace agent hydration)", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.appendMessage({
      id: "local-1",
      role: "user",
      content: "cached prompt",
      createdAt: "2026-05-25T00:00:00.000Z",
    });

    const hydrated = chatStore.setThreadMessages(
      [
        {
          id: "oc-u1",
          role: "user",
          content: "fresh prompt",
          createdAt: "2026-05-25T00:00:00.000Z",
          parts: [{ type: "text", text: "fresh prompt" }],
        },
        {
          id: "oc-a1",
          role: "assistant",
          content: "fresh reply",
          createdAt: "2026-05-25T00:00:01.000Z",
          parts: [
            { type: "reasoning", text: "thinking" },
            { type: "text", text: "fresh reply" },
          ],
        },
      ],
      "session-1",
      "/work/a",
    );

    expect(hydrated).toBe(true);
    const messages = chatStore.getMessages();
    expect(messages.map((message) => message.id)).toEqual(["oc-u1", "oc-a1"]);
    expect(messages[1]?.parts).toEqual([
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "fresh reply" },
    ]);
    expect(chatStore.getMetadata()?.updatedAt).toBe("2026-05-25T00:00:01.000Z");
  });

  it("setThreadMessages returns false when no thread exists for the agent", () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    const updated = chatStore.setThreadMessages(
      [{ id: "x", role: "user", content: "hi", createdAt: "2026-05-25T00:00:00.000Z" }],
      "agent-missing",
      "/work/a",
    );
    expect(updated).toBe(false);
  });
});
