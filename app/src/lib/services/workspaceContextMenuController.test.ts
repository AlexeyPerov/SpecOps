import { describe, expect, it, vi } from "vitest";
import type { ContextId } from "../domain/contracts";
import { createWorkspaceContextMenuActions } from "./workspaceContextMenuController";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../state/appState", () => ({
  appState: {
    switchContext: vi.fn(() => true),
    openOrFocusViewTab: vi.fn(),
    reorderWorkspaces: vi.fn(),
    closeWorkspace: vi.fn(() => true),
    getSnapshot: vi.fn(() => ({
      settings: { gitIntegration: { enabled: true } },
    })),
  },
}));

vi.mock("./workspaceLifecycle", () => ({
  markWorkspaceLifecycleActive: vi.fn(),
}));

vi.mock("./workspaceCloseFlow", () => ({
  closeWorkspaceWithConfirm: vi.fn().mockResolvedValue(true),
}));

import { appState } from "../state/appState";
import { markWorkspaceLifecycleActive } from "./workspaceLifecycle";

describe("createWorkspaceContextMenuActions", () => {
  function createActions(options: {
    previousActiveContextId?: ContextId | null;
    loadProjectTreeRoot?: () => Promise<void>;
    workspaceRootPath?: string | null;
  } = {}) {
    const actions = createWorkspaceContextMenuActions({
      getWorkspaceRootPath: () => options.workspaceRootPath ?? "/tmp/workspace",
      getPreviousActiveContextId: () => options.previousActiveContextId ?? null,
      setPreviousActiveContextId: () => {},
      setConsoleOpen: () => {},
      setMarkdownViewMode: () => {},
      loadProjectTreeRoot: options.loadProjectTreeRoot ?? (async () => {}),
      notify: () => {},
    });
    return { actions };
  }

  it("openVersionControl switches context and opens the tab", () => {
    vi.mocked(appState.switchContext).mockReturnValue(true);
    const { actions } = createActions();

    actions.openVersionControl("ws-1");

    expect(appState.switchContext).toHaveBeenCalledWith("ws-1");
    expect(markWorkspaceLifecycleActive).toHaveBeenCalled();
    expect(appState.openOrFocusViewTab).toHaveBeenCalledWith("version-control");
  });

  it("leaves project-tree loading to the root-keyed shell effect on context switch", () => {
    const loadProjectTreeRoot = vi.fn(async () => {});
    const { actions } = createActions({
      previousActiveContextId: "ws-2",
      loadProjectTreeRoot,
    });

    actions.handleActiveContextSwitch("ws-1");

    expect(loadProjectTreeRoot).not.toHaveBeenCalled();
  });
});
