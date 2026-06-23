import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIndexEntry } from "../domain/contracts";
import { createAppShellAgentHandlers } from "./appShellAgentHandlers";
import { WorkspaceAgentBackendError } from "../ai/backends/workspaceAgentBackend";
import { appState } from "../state/appState";
import { chatStore } from "../state/chatStore";
import { WorkspaceAccessReason } from "../ai/capabilities";

const { logDiagnosticMock, ensureOpencodeSidecarMock } = vi.hoisted(() => ({
  logDiagnosticMock: vi.fn().mockResolvedValue(undefined),
  ensureOpencodeSidecarMock: vi.fn(),
}));
vi.mock("./logging", () => ({
  logDiagnostic: logDiagnosticMock,
}));

vi.mock("./opencodeSidecarEnsure", () => ({
  ensureOpencodeSidecar: ensureOpencodeSidecarMock,
}));

vi.mock("../state/appState", () => ({
  appState: {
    getActiveSession: vi.fn(),
    setLastActiveAgentId: vi.fn(),
    openOrFocusAgentTab: vi.fn(),
    selectTab: vi.fn(),
    getSnapshot: vi.fn(() => ({
      settings: {
        opencode: { enabled: true, mode: "sidecar", baseUrl: "http://127.0.0.1:4096" },
      },
    })),
  },
}));

vi.mock("../state/chatStore", () => ({
  chatStore: {
    loadWorkspaceAgents: vi.fn(),
    mergeSessionDraftAgents: vi.fn(),
    getAgentIndex: vi.fn(),
    getActiveWorkspaceRoot: vi.fn(),
    getAgentSessionLink: vi.fn(),
    forkAgent: vi.fn(),
    setActiveAgentId: vi.fn(),
    runAccessPreflight: vi.fn(),
    clearAgentSessionLink: vi.fn(),
    setThreadMessages: vi.fn(),
    getActiveAgentId: vi.fn(() => null),
    getActiveThreadSnapshot: vi.fn(() => null),
  },
}));

const backendListSessionsMock = vi.fn();
const backendListMessagesMock = vi.fn();
const backendGetSessionDetailsMock = vi.fn();
const backendListSessionDetailsMock = vi.fn();
vi.mock("../ai/backends/workspaceAgentBackend", async () => {
  const actual = await vi.importActual("../ai/backends/workspaceAgentBackend");
  return {
    ...actual,
    createWorkspaceAgentBackend: vi.fn(() => ({
      listSessions: backendListSessionsMock,
      listMessages: backendListMessagesMock,
      getSessionDetails: backendGetSessionDetailsMock,
      listSessionDetails: backendListSessionDetailsMock,
    })),
  };
});

const appStateMock = vi.mocked(appState);
const chatStoreMock = vi.mocked(chatStore);

function makeEntry(input: {
  id: string;
  opencodeSessionId?: string;
}): AgentIndexEntry {
  return {
    id: input.id,
    title: input.id,
    lastUsedAt: "2026-06-10T09:00:00.000Z",
    opencodeSessionId: input.opencodeSessionId,
  };
}

describe("createAppShellAgentHandlers.restoreWorkspaceAgentSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backendListSessionsMock.mockReset();
    backendListMessagesMock.mockReset();
    backendGetSessionDetailsMock.mockReset();
    ensureOpencodeSidecarMock.mockReset();
    // Default: sidecar not running → L3 background sync skipped.
    ensureOpencodeSidecarMock.mockResolvedValue(null);

    appStateMock.getActiveSession.mockReturnValue({
      selectedTabId: "tab-file",
      openTabs: [],
      lastActiveWindowId: "main",
      windowBounds: null,
      lastActiveAgentId: "agent-a",
    });

    chatStoreMock.loadWorkspaceAgents.mockResolvedValue(undefined);
    chatStoreMock.mergeSessionDraftAgents.mockImplementation(() => {});
    chatStoreMock.setActiveAgentId.mockImplementation(() => {});
    chatStoreMock.setThreadMessages.mockImplementation(() => true);
    chatStoreMock.runAccessPreflight.mockResolvedValue({
      status: "ready",
      reason: WorkspaceAccessReason.Unknown,
      message: "ok",
      checkedAt: "2026-06-10T09:00:00.000Z",
    });
    chatStoreMock.clearAgentSessionLink.mockImplementation(() => false);
    chatStoreMock.getActiveAgentId.mockReturnValue(null);
    chatStoreMock.getActiveThreadSnapshot.mockReturnValue(null);
    chatStoreMock.getAgentSessionLink.mockReturnValue(null);
    chatStoreMock.getActiveWorkspaceRoot.mockReturnValue("/repo/ws-a");
  });

  it("clears stale session mappings during workspace restore", async () => {
    chatStoreMock.getAgentIndex.mockReturnValue([
      makeEntry({ id: "agent-a", opencodeSessionId: "sess-stale" }),
      makeEntry({ id: "agent-b", opencodeSessionId: "sess-live" }),
    ]);
    // M13.5 — L3 background sync runs only when sidecar is healthy, active
    // session is linked, thread has messages, and last message role is user.
    ensureOpencodeSidecarMock.mockResolvedValue({
      status: {
        running: true,
        baseUrl: "http://127.0.0.1:4096",
        health: "healthy",
        directory: "/repo/ws-a",
        port: 4096,
        pid: 42,
        lastError: null,
      },
      spawned: false,
    });
    chatStoreMock.getActiveAgentId.mockReturnValue("agent-a");
    chatStoreMock.getAgentSessionLink.mockReturnValue({
      opencodeSessionId: "sess-stale",
      opencodeModelId: undefined,
      opencodeProviderId: undefined,
    });
    chatStoreMock.getActiveThreadSnapshot.mockReturnValue({
      messages: [
        {
          id: "u1",
          role: "user",
          content: "fresh",
          parts: [],
          createdAt: "2026-06-10T09:00:00.000Z",
        },
      ],
      metadata: {
        mode: "ask",
        agentId: "agent-a",
        threadId: "t",
        createdAt: "2026-06-10T09:00:00.000Z",
        updatedAt: "2026-06-10T09:00:00.000Z",
        selectedModelId: "",
        connectionId: undefined,
        opencodeAgentId: undefined,
        opencodeProviderId: undefined,
        compactedMessageCount: 0,
        summary: "",
      },
    });
    backendListSessionsMock.mockResolvedValue([
      {
        id: "sess-live",
        title: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);

    const handlers = createAppShellAgentHandlers({
      getIsChatHttpActive: () => false,
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await handlers.restoreWorkspaceAgentSession("/repo/ws-a");

    // The L3 background sync is fire-and-forget; wait a tick for the
    // reconcile to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chatStoreMock.clearAgentSessionLink).toHaveBeenCalledTimes(1);
    expect(chatStoreMock.clearAgentSessionLink).toHaveBeenCalledWith("agent-a", "/repo/ws-a");
  });

  it("keeps existing mappings when session listing is unavailable", async () => {
    chatStoreMock.getAgentIndex.mockReturnValue([
      makeEntry({ id: "agent-a", opencodeSessionId: "sess-stale" }),
    ]);
    backendListSessionsMock.mockRejectedValue(
      new WorkspaceAgentBackendError({
        code: "serverUnavailable",
        message: "offline",
      }),
    );

    const handlers = createAppShellAgentHandlers({
      getIsChatHttpActive: () => false,
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await expect(handlers.restoreWorkspaceAgentSession("/repo/ws-a")).resolves.toBeUndefined();
    expect(chatStoreMock.clearAgentSessionLink).not.toHaveBeenCalled();
  });

  it("skips opencode reconcile when skipOpencodeReconcile is set", async () => {
    chatStoreMock.getAgentIndex.mockReturnValue([
      makeEntry({ id: "agent-a", opencodeSessionId: "sess-stale" }),
    ]);

    const handlers = createAppShellAgentHandlers({
      getIsChatHttpActive: () => false,
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await handlers.restoreWorkspaceAgentSession("/repo/ws-a", { skipOpencodeReconcile: true });

    expect(backendListSessionsMock).not.toHaveBeenCalled();
    expect(chatStoreMock.clearAgentSessionLink).not.toHaveBeenCalled();
  });

  it("hydrates thread messages from session.messages during restore (M1-T3)", async () => {
    chatStoreMock.getAgentIndex.mockReturnValue([
      makeEntry({ id: "agent-a", opencodeSessionId: "sess-a" }),
      makeEntry({ id: "agent-b" }), // no session link — skipped
    ]);
    // M13.5 — L3 conditions met: sidecar healthy, linked session, thread has
    // ≥1 message, last message role is user.
    ensureOpencodeSidecarMock.mockResolvedValue({
      status: {
        running: true,
        baseUrl: "http://127.0.0.1:4096",
        health: "healthy",
        directory: "/repo/ws-a",
        port: 4096,
        pid: 42,
        lastError: null,
      },
      spawned: false,
    });
    chatStoreMock.getActiveAgentId.mockReturnValue("agent-a");
    chatStoreMock.getAgentSessionLink.mockReturnValue({
      opencodeSessionId: "sess-a",
      opencodeModelId: undefined,
      opencodeProviderId: undefined,
    });
    chatStoreMock.getActiveThreadSnapshot.mockReturnValue({
      messages: [
        {
          id: "u1",
          role: "user",
          content: "fresh prompt",
          parts: [],
          createdAt: "2026-06-10T09:00:00.000Z",
        },
      ],
      metadata: {
        mode: "ask",
        agentId: "agent-a",
        threadId: "t",
        createdAt: "2026-06-10T09:00:00.000Z",
        updatedAt: "2026-06-10T09:00:00.000Z",
        selectedModelId: "",
        connectionId: undefined,
        opencodeAgentId: undefined,
        opencodeProviderId: undefined,
        compactedMessageCount: 0,
        summary: "",
      },
    });
    backendListSessionsMock.mockResolvedValue([{ id: "sess-a" }]);
    backendListMessagesMock.mockResolvedValue([
      {
        info: { id: "u1", role: "user", time: { created: 1 } },
        parts: [{ type: "text", text: "fresh prompt" }],
      },
    ]);

    const handlers = createAppShellAgentHandlers({
      getIsChatHttpActive: () => false,
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await handlers.restoreWorkspaceAgentSession("/repo/ws-a");

    // L3 background sync is fire-and-forget; wait for it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(backendListMessagesMock).toHaveBeenCalledTimes(1);
    expect(backendListMessagesMock).toHaveBeenCalledWith({
      workspaceRootPath: "/repo/ws-a",
      sessionId: "sess-a",
    });
    expect(chatStoreMock.setThreadMessages).toHaveBeenCalledTimes(1);
    const [messages, agentId, root] = chatStoreMock.setThreadMessages.mock.calls[0];
    expect(agentId).toBe("agent-a");
    expect(root).toBe("/repo/ws-a");
    expect(messages[0]).toMatchObject({ id: "u1", content: "fresh prompt" });
  });

  it("keeps the local snapshot when session.messages hydration fails (non-fatal)", async () => {
    chatStoreMock.getAgentIndex.mockReturnValue([
      makeEntry({ id: "agent-a", opencodeSessionId: "sess-a" }),
    ]);
    backendListSessionsMock.mockResolvedValue([{ id: "sess-a" }]);
    backendListMessagesMock.mockRejectedValue(
      new WorkspaceAgentBackendError({
        code: "serverUnavailable",
        message: "offline",
      }),
    );

    const handlers = createAppShellAgentHandlers({
      getIsChatHttpActive: () => false,
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await expect(handlers.restoreWorkspaceAgentSession("/repo/ws-a")).resolves.toBeUndefined();
    expect(chatStoreMock.setThreadMessages).not.toHaveBeenCalled();
  });
});

describe("createAppShellAgentHandlers.handleOpenExternalSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backendListSessionsMock.mockReset();
    backendListMessagesMock.mockReset();
    backendGetSessionDetailsMock.mockReset();

    appStateMock.getActiveSession.mockReturnValue({
      selectedTabId: "tab-agent",
      openTabs: [],
      lastActiveWindowId: "main",
      windowBounds: null,
      lastActiveAgentId: null,
    });
    chatStoreMock.getActiveWorkspaceRoot.mockReturnValue("/repo/ws-a");
    chatStoreMock.getAgentIndex.mockReturnValue([]);
    chatStoreMock.forkAgent.mockReturnValue("agent-new");
    chatStoreMock.setThreadMessages.mockImplementation(() => true);
  });

  it("creates a tab, seeds the title from getSessionDetails, and best-effort hydrates", async () => {
    backendGetSessionDetailsMock.mockResolvedValue({
      id: "sess-ext",
      title: "External chat",
      createdAt: null,
      updatedAt: null,
      parentId: null,
      shareUrl: null,
      cost: null,
      revert: null,
    });
    // After forkAgent, the index should contain the new linked agent so
    // hydration picks it up.
    chatStoreMock.getAgentIndex
      .mockReturnValueOnce([]) // pre-fork lookup (no existing tab)
      .mockReturnValueOnce([
        makeEntry({ id: "agent-new", opencodeSessionId: "sess-ext" }),
      ]);
    backendListMessagesMock.mockResolvedValue([
      {
        info: { id: "u1", role: "user", time: { created: 1 } },
        parts: [{ type: "text", text: "hello from external" }],
      },
    ]);

    const handlers = createAppShellAgentHandlers({
      getIsChatHttpActive: () => false,
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await handlers.handleOpenExternalSession("sess-ext");

    expect(backendGetSessionDetailsMock).toHaveBeenCalledWith({
      workspaceRootPath: "/repo/ws-a",
      sessionId: "sess-ext",
    });
    expect(chatStoreMock.forkAgent).toHaveBeenCalledTimes(1);
    const [forkArg] = chatStoreMock.forkAgent.mock.calls[0]!;
    expect(forkArg).toMatchObject({
      opencodeSessionId: "sess-ext",
      title: "External chat",
    });
    // Best-effort hydration ran for the newly-linked session.
    expect(backendListMessagesMock).toHaveBeenCalledWith({
      workspaceRootPath: "/repo/ws-a",
      sessionId: "sess-ext",
    });
    expect(chatStoreMock.setThreadMessages).toHaveBeenCalledTimes(1);
  });

  it("falls back to the caller-supplied title when getSessionDetails fails", async () => {
    backendGetSessionDetailsMock.mockRejectedValue(
      new WorkspaceAgentBackendError({
        code: "serverUnavailable",
        message: "offline",
      }),
    );
    chatStoreMock.getAgentIndex.mockReturnValue([]);

    const handlers = createAppShellAgentHandlers({
      getIsChatHttpActive: () => false,
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await expect(handlers.handleOpenExternalSession("sess-ext", "From list")).resolves.toBeUndefined();

    const [forkArg] = chatStoreMock.forkAgent.mock.calls[0]!;
    expect(forkArg).toMatchObject({ title: "From list" });
  });

  it("does not throw when hydration fails (best-effort)", async () => {
    backendGetSessionDetailsMock.mockResolvedValue({
      id: "sess-ext",
      title: "External chat",
      createdAt: null,
      updatedAt: null,
      parentId: null,
      shareUrl: null,
      cost: null,
      revert: null,
    });
    chatStoreMock.getAgentIndex.mockReturnValue([
      makeEntry({ id: "agent-new", opencodeSessionId: "sess-ext" }),
    ]);
    backendListMessagesMock.mockRejectedValue(
      new WorkspaceAgentBackendError({
        code: "serverUnavailable",
        message: "offline",
      }),
    );

    const handlers = createAppShellAgentHandlers({
      getIsChatHttpActive: () => false,
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await expect(handlers.handleOpenExternalSession("sess-ext")).resolves.toBeUndefined();
    expect(chatStoreMock.setThreadMessages).not.toHaveBeenCalled();
  });
});

describe("createAppShellAgentHandlers.handleListWorkspaceSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backendListSessionsMock.mockReset();
    backendListMessagesMock.mockReset();
    backendGetSessionDetailsMock.mockReset();
    backendListSessionDetailsMock.mockReset();

    appStateMock.getActiveSession.mockReturnValue({
      selectedTabId: "tab-agent",
      openTabs: [],
      lastActiveWindowId: "main",
      windowBounds: null,
      lastActiveAgentId: null,
    });
    chatStoreMock.getActiveWorkspaceRoot.mockReturnValue("/repo/ws-a");
  });

  it("emits a diagnostic and degrades to [] on backend failure (M7-T5)", async () => {
    backendListSessionDetailsMock.mockRejectedValue(
      new WorkspaceAgentBackendError({ code: "serverUnavailable", message: "offline" }),
    );

    const handlers = createAppShellAgentHandlers({
      getIsChatHttpActive: () => false,
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await expect(handlers.handleListWorkspaceSessions()).resolves.toEqual([]);

    expect(logDiagnosticMock).toHaveBeenCalledTimes(1);
    const event = logDiagnosticMock.mock.calls[0]![0];
    expect(event.level).toBe("warn");
    expect(event.metadata).toMatchObject({
      kind: "opencode.session.list",
      workspaceRootPath: "/repo/ws-a",
    });
  });

  it("returns the session list on success without emitting a diagnostic", async () => {
    backendListSessionDetailsMock.mockResolvedValue([
      {
        id: "sess-a",
        title: "A",
        createdAt: null,
        updatedAt: null,
        parentId: null,
        shareUrl: null,
        cost: null,
        revert: null,
      },
    ]);

    const handlers = createAppShellAgentHandlers({
      getIsChatHttpActive: () => false,
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    const result = await handlers.handleListWorkspaceSessions();
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("sess-a");
    expect(logDiagnosticMock).not.toHaveBeenCalled();
  });
});
