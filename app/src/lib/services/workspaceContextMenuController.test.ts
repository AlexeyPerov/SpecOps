import { describe, expect, it, vi } from "vitest";
import {
  computeWorkspaceReorderTarget,
  createWorkspaceContextMenuActions,
  findWorkspaceIndex,
  type WorkspaceContextMenuState,
} from "./workspaceContextMenuController";

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

describe("findWorkspaceIndex", () => {
  it("returns the index of a workspace id", () => {
    expect(findWorkspaceIndex(["ws-1", "ws-2", "ws-3"], "ws-2")).toBe(1);
  });

  it("returns -1 when the workspace is missing", () => {
    expect(findWorkspaceIndex(["ws-1"], "missing")).toBe(-1);
  });
});

describe("computeWorkspaceReorderTarget", () => {
  const workspaceCount = 3;

  it("moves up within bounds", () => {
    expect(computeWorkspaceReorderTarget(1, "up", workspaceCount)).toBe(0);
  });

  it("moves down within bounds", () => {
    expect(computeWorkspaceReorderTarget(1, "down", workspaceCount)).toBe(2);
  });

  it("returns null when moving up from the first workspace", () => {
    expect(computeWorkspaceReorderTarget(0, "up", workspaceCount)).toBeNull();
  });

  it("returns null when moving down from the last workspace", () => {
    expect(computeWorkspaceReorderTarget(2, "down", workspaceCount)).toBeNull();
  });

  it("returns null when the current index is invalid", () => {
    expect(computeWorkspaceReorderTarget(-1, "down", workspaceCount)).toBeNull();
  });
});

describe("createWorkspaceContextMenuActions", () => {
  function createActions() {
    let menu: WorkspaceContextMenuState | null = {
      workspaceId: "ws-1",
      x: 10,
      y: 20,
    };
    const actions = createWorkspaceContextMenuActions({
      getMenu: () => menu,
      setMenu: (nextMenu) => {
        menu = nextMenu;
      },
      getMenuEl: () => null,
      getWorkspaceIds: () => ["ws-1"],
      getPreviousActiveContextId: () => null,
      setPreviousActiveContextId: () => {},
      setConsoleOpen: () => {},
      setMarkdownViewMode: () => {},
      loadProjectTreeRoot: async () => {},
      notify: () => {},
    });
    return { actions, getMenu: () => menu };
  }

  it("openVersionControl switches context, opens the tab, and closes the menu", () => {
    vi.mocked(appState.switchContext).mockReturnValue(true);
    const { actions, getMenu } = createActions();

    actions.openVersionControl("ws-1");

    expect(appState.switchContext).toHaveBeenCalledWith("ws-1");
    expect(markWorkspaceLifecycleActive).toHaveBeenCalled();
    expect(appState.openOrFocusViewTab).toHaveBeenCalledWith("version-control");
    expect(getMenu()).toBeNull();
  });
});
