import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIndexEntry } from "../domain/contracts";
import { createAppShellAgentHandlers } from "./appShellAgentHandlers";
import { WorkspaceAgentBackendError } from "../ai/backends/workspaceAgentBackend";
import { appState } from "../state/appState";
import { chatStore } from "../state/chatStore";
import { WorkspaceAccessReason } from "../ai/capabilities";

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
    setActiveAgentId: vi.fn(),
    runAccessPreflight: vi.fn(),
    clearAgentSessionLink: vi.fn(),
    setThreadMessages: vi.fn(),
  },
}));

const backendListSessionsMock = vi.fn();
const backendListMessagesMock = vi.fn();
vi.mock("../ai/backends/workspaceAgentBackend", async () => {
  const actual = await vi.importActual("../ai/backends/workspaceAgentBackend");
  return {
    ...actual,
    createWorkspaceAgentBackend: vi.fn(() => ({
      listSessions: backendListSessionsMock,
      listMessages: backendListMessagesMock,
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
  });

  it("clears stale session mappings during workspace restore", async () => {
    chatStoreMock.getAgentIndex.mockReturnValue([
      makeEntry({ id: "agent-a", opencodeSessionId: "sess-stale" }),
      makeEntry({ id: "agent-b", opencodeSessionId: "sess-live" }),
    ]);
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
