import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAppShellAgentHandlers } from "./appShellAgentHandlers";
import { appState } from "../state/appState";
import { chatStore } from "../state/chatStore";
import { WorkspaceAccessReason } from "../ai/capabilities";
import { createSinglePaneLayout } from "../domain/contracts";

const { agentHostClientMock, entryNamePromptMock } = vi.hoisted(() => ({
  agentHostClientMock: {
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    getStatus: vi.fn(),
  },
  entryNamePromptMock: vi.fn(),
}));

vi.mock("./agentHostRuntime", async () => {
  const actual = await vi.importActual("./agentHostRuntime");
  return {
    ...actual,
    getAgentHostClient: vi.fn(() => agentHostClientMock),
    resetAgentHostEnsureCache: vi.fn(),
  };
});

vi.mock("./entryNamePrompt", () => ({
  promptEntryName: entryNamePromptMock,
}));

vi.mock("../state/appState", () => ({
  appState: {
    getActiveSession: vi.fn(),
    getWorkspaceRoot: vi.fn(() => "/repo/ws-a"),
    setLastActiveSessionId: vi.fn(),
    openOrFocusSessionTab: vi.fn(),
    closeTabsForSession: vi.fn(),
    selectTab: vi.fn(),
    getSnapshot: vi.fn(() => ({
      settings: {
        opencode: { enabled: true, mode: "sidecar", baseUrl: "http://127.0.0.1:4096", sidecarPort: 4096 },
      },
    })),
  },
}));

vi.mock("../state/chatStore", () => ({
  chatStore: {
    loadWorkspaceSessions: vi.fn(),
    mergeSessionDrafts: vi.fn(),
    getSessionIndex: vi.fn(),
    getSessionTitle: vi.fn(() => null),
    getActiveWorkspaceRoot: vi.fn(),
    getSessionLink: vi.fn(),
    setActiveSessionId: vi.fn(),
    ensureSessionThreadHydrated: vi.fn(),
    runAccessPreflight: vi.fn(),
    renameSession: vi.fn(),
    createDraftSession: vi.fn(),
    deleteSession: vi.fn(),
    cancelSessionGeneration: vi.fn(),
    getActiveSessionId: vi.fn(() => null),
    getActiveThreadSnapshot: vi.fn(() => null),
  },
}));

const appStateMock = vi.mocked(appState);
const chatStoreMock = vi.mocked(chatStore);

describe("createAppShellAgentHandlers.restoreWorkspaceSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appStateMock.getSnapshot.mockReturnValue({
      settings: {
        opencode: { enabled: true, mode: "sidecar", baseUrl: "http://127.0.0.1:4096", sidecarPort: 4096 },
      },
    });

    appStateMock.getActiveSession.mockReturnValue({
      editorLayout: createSinglePaneLayout([], "tab-file"),
      lastActiveWindowId: "main",
      windowBounds: null,
      lastActiveSessionId: "agent-a",
    });
    appStateMock.getWorkspaceRoot.mockReturnValue("/repo/ws-a");

    chatStoreMock.loadWorkspaceSessions.mockResolvedValue(undefined);
    chatStoreMock.mergeSessionDrafts.mockImplementation(() => {});
    chatStoreMock.setActiveSessionId.mockImplementation(() => {});
    chatStoreMock.ensureSessionThreadHydrated.mockResolvedValue(null);
    chatStoreMock.runAccessPreflight.mockResolvedValue({
      status: "ready",
      reason: WorkspaceAccessReason.Unknown,
      message: "ok",
      checkedAt: "2026-06-10T09:00:00.000Z",
    });
    chatStoreMock.getSessionIndex.mockReturnValue([]);
    chatStoreMock.getActiveSessionId.mockReturnValue(null);
    chatStoreMock.getActiveThreadSnapshot.mockReturnValue(null);
    chatStoreMock.getSessionLink.mockReturnValue(null);
    chatStoreMock.getActiveWorkspaceRoot.mockReturnValue("/repo/ws-a");
  });

  it("does not mutate another context when session loading finishes after switching away", async () => {
    let finishLoading!: () => void;
    chatStoreMock.loadWorkspaceSessions.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishLoading = resolve;
      }),
    );

    const handlers = createAppShellAgentHandlers({
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });
    const restore = handlers.restoreWorkspaceSession("/repo/ws-a");
    await vi.waitFor(() => expect(chatStoreMock.loadWorkspaceSessions).toHaveBeenCalled());

    appStateMock.getWorkspaceRoot.mockReturnValue(null);
    finishLoading();
    await restore;

    expect(chatStoreMock.mergeSessionDrafts).not.toHaveBeenCalled();
    expect(chatStoreMock.setActiveSessionId).not.toHaveBeenCalled();
    expect(appStateMock.setLastActiveSessionId).not.toHaveBeenCalled();
    expect(appStateMock.openOrFocusSessionTab).not.toHaveBeenCalled();
  });

  it("does not focus a restored session when hydration finishes after switching away", async () => {
    let finishHydration!: () => void;
    chatStoreMock.getSessionIndex.mockReturnValue([
      { id: "agent-a", title: "A", lastUsedAt: "2026-06-10T09:00:00.000Z" },
    ]);
    chatStoreMock.ensureSessionThreadHydrated.mockImplementation(
      () => new Promise<null>((resolve) => {
        finishHydration = () => resolve(null);
      }),
    );

    const handlers = createAppShellAgentHandlers({
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });
    const restore = handlers.restoreWorkspaceSession("/repo/ws-a");
    await vi.waitFor(() => expect(chatStoreMock.ensureSessionThreadHydrated).toHaveBeenCalled());

    appStateMock.getWorkspaceRoot.mockReturnValue(null);
    finishHydration();
    await restore;

    expect(chatStoreMock.setActiveSessionId).not.toHaveBeenCalled();
    expect(appStateMock.setLastActiveSessionId).not.toHaveBeenCalled();
    expect(appStateMock.openOrFocusSessionTab).not.toHaveBeenCalled();
  });

  it("clears the active session when the sessions gate is disabled", async () => {
    appStateMock.getSnapshot.mockReturnValue({
      settings: {
        opencode: { enabled: false, mode: "sidecar", baseUrl: "http://127.0.0.1:4096", sidecarPort: 4096 },
      },
    });

    const handlers = createAppShellAgentHandlers({
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await handlers.restoreWorkspaceSession("/repo/ws-a");

    expect(chatStoreMock.loadWorkspaceSessions).not.toHaveBeenCalled();
    expect(chatStoreMock.setActiveSessionId).toHaveBeenCalledWith(null);
    expect(appStateMock.setLastActiveSessionId).toHaveBeenCalledWith(null);
  });

  it("requests cache-first session loading for ordinary workspace re-entry", async () => {
    appStateMock.getActiveSession.mockReturnValue({
      editorLayout: createSinglePaneLayout([], "tab-file"),
      lastActiveWindowId: "main",
      windowBounds: null,
      lastActiveSessionId: null,
    });
    const handlers = createAppShellAgentHandlers({
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await handlers.restoreWorkspaceSession("/repo/ws-a", {
      preferCachedIndex: true,
    });

    expect(chatStoreMock.loadWorkspaceSessions).toHaveBeenCalledWith("/repo/ws-a", {
      prioritySessionIds: [],
      preferCachedIndex: true,
    });
  });

  it("focuses the last-active session when it still exists in the index", async () => {
    chatStoreMock.getSessionIndex.mockReturnValue([
      { id: "agent-a", title: "A", lastUsedAt: "2026-06-10T09:00:00.000Z" },
    ]);

    const handlers = createAppShellAgentHandlers({
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await handlers.restoreWorkspaceSession("/repo/ws-a");

    expect(chatStoreMock.loadWorkspaceSessions).toHaveBeenCalledWith("/repo/ws-a", {
      prioritySessionIds: ["agent-a"],
    });
    expect(chatStoreMock.ensureSessionThreadHydrated).toHaveBeenCalledWith("agent-a", "/repo/ws-a");
    expect(chatStoreMock.setActiveSessionId).toHaveBeenCalledWith("agent-a");
    expect(appStateMock.openOrFocusSessionTab).toHaveBeenCalledWith("agent-a");
  });
});

describe("createAppShellAgentHandlers.handleRenameSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatStoreMock.getActiveWorkspaceRoot.mockReturnValue("/repo/ws-a");
    chatStoreMock.getSessionTitle.mockReturnValue(null);
    chatStoreMock.renameSession.mockReturnValue(true);
  });

  it("renames locally when a new title is confirmed", async () => {
    entryNamePromptMock.mockResolvedValue("Renamed session");
    const notify = vi.fn();
    const handlers = createAppShellAgentHandlers({
      getCurrentWindowId: () => "main",
      notify,
    });

    await handlers.handleRenameSession("agent-a");

    expect(chatStoreMock.renameSession).toHaveBeenCalledWith(
      "agent-a",
      "Renamed session",
      "/repo/ws-a",
    );
    expect(notify).toHaveBeenCalledWith("Session renamed.");
  });

  it("does not rename when the prompt is dismissed", async () => {
    entryNamePromptMock.mockResolvedValue(null);
    const handlers = createAppShellAgentHandlers({
      getCurrentWindowId: () => "main",
      notify: vi.fn(),
    });

    await handlers.handleRenameSession("agent-a");

    expect(chatStoreMock.renameSession).not.toHaveBeenCalled();
  });
});

describe("createAppShellAgentHandlers.handleRestartAgentHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restarts the host through the shared client and notifies", async () => {
    agentHostClientMock.restart.mockResolvedValue({ health: "healthy", running: true });
    const notify = vi.fn();
    const handlers = createAppShellAgentHandlers({
      getCurrentWindowId: () => "main",
      notify,
    });

    await handlers.handleRestartAgentHost();

    expect(agentHostClientMock.restart).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Agent host restarted.");
  });

  it("surfaces restart failures via notify instead of throwing", async () => {
    agentHostClientMock.restart.mockRejectedValue({
      kind: "crashLoop",
      message: "breaker open",
    });
    const notify = vi.fn();
    const handlers = createAppShellAgentHandlers({
      getCurrentWindowId: () => "main",
      notify,
    });

    await expect(handlers.handleRestartAgentHost()).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith("Agent host restart failed: breaker open");
  });
});
