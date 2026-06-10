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
  },
}));

const backendListSessionsMock = vi.fn();
vi.mock("../ai/backends/workspaceAgentBackend", async () => {
  const actual = await vi.importActual("../ai/backends/workspaceAgentBackend");
  return {
    ...actual,
    createWorkspaceAgentBackend: vi.fn(() => ({
      listSessions: backendListSessionsMock,
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
});
