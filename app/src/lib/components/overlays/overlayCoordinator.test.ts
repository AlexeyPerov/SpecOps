import { describe, expect, it } from "vitest";
import {
  createOverlayCoordinator,
  type OverlayState,
} from "./overlayCoordinator";
import type { ContextId } from "../../domain/contracts";

/** Build a coordinator over a mutable state object, returning both. */
function setup(initial: Partial<OverlayState> = {}) {
  const state: OverlayState = {
    quickOpenOpen: false,
    commandPaletteOpen: false,
    headingJumpOpen: false,
    bookmarkListOpen: false,
    snippetInsertOpen: false,
    projectSearchOpen: false,
    sessionListOpen: false,
    addMultipleOpen: false,
    timelineOpen: false,
    workspaceContextMenu: null,
    ...initial,
  };
  const patchLog: Array<Partial<OverlayState>> = [];
  // Wrap the counter in an object so callers can read it after the coordinator
  // has mutated it (destructuring a `let number` captures the value at
  // destructure time).
  const counters = { snippetHostIdentityClears: 0 };
  const coordinator = createOverlayCoordinator({
    getState: () => ({ ...state }),
    patch: (p) => {
      patchLog.push(p);
      Object.assign(state, p);
    },
    clearSnippetInsertHostIdentity: () => {
      counters.snippetHostIdentityClears += 1;
    },
  });
  return { state, patchLog, counters, coordinator };
}

const WORKSPACE_ID: ContextId = "ws-1";

describe("createOverlayCoordinator.closeOtherPickers", () => {
  it("closes every picker except the named one", () => {
    const { state, coordinator } = setup({
      quickOpenOpen: true,
      commandPaletteOpen: true,
      headingJumpOpen: true,
      bookmarkListOpen: true,
      snippetInsertOpen: true,
    });
    coordinator.closeOtherPickers("headingJump");
    expect(state.quickOpenOpen).toBe(false);
    expect(state.commandPaletteOpen).toBe(false);
    expect(state.headingJumpOpen).toBe(true);
    expect(state.bookmarkListOpen).toBe(false);
    expect(state.snippetInsertOpen).toBe(false);
  });

  it("clears the snippet-insert host identity when closing snippetInsert", () => {
    const { counters, coordinator } = setup({
      snippetInsertOpen: true,
    });
    coordinator.closeOtherPickers("quickOpen");
    expect(counters.snippetHostIdentityClears).toBe(1);
  });

  it("does NOT clear the host identity when snippetInsert is the kept picker", () => {
    const { counters, coordinator } = setup({
      snippetInsertOpen: true,
    });
    coordinator.closeOtherPickers("snippetInsert");
    expect(counters.snippetHostIdentityClears).toBe(0);
  });

  it("does not touch projectSearch / sessionList / addMultiple / timeline", () => {
    // Those overlays are outside the close-others matrix.
    const { state, coordinator } = setup({
      quickOpenOpen: true,
      projectSearchOpen: true,
      sessionListOpen: true,
      addMultipleOpen: true,
      timelineOpen: true,
    });
    coordinator.closeOtherPickers("headingJump");
    expect(state.projectSearchOpen).toBe(true);
    expect(state.sessionListOpen).toBe(true);
    expect(state.addMultipleOpen).toBe(true);
    expect(state.timelineOpen).toBe(true);
  });
});

describe("createOverlayCoordinator.shouldCloseEditorTools", () => {
  it("returns true for command palette, heading jump, bookmark list, snippet insert", () => {
    const { coordinator } = setup();
    expect(coordinator.shouldCloseEditorTools("commandPalette")).toBe(true);
    expect(coordinator.shouldCloseEditorTools("headingJump")).toBe(true);
    expect(coordinator.shouldCloseEditorTools("bookmarkList")).toBe(true);
    expect(coordinator.shouldCloseEditorTools("snippetInsert")).toBe(true);
  });

  it("returns false for quick open (pre-refactor openQuickOpen did NOT close editor tools)", () => {
    const { coordinator } = setup();
    expect(coordinator.shouldCloseEditorTools("quickOpen")).toBe(false);
  });

  it("returns false for non-picker overlays", () => {
    const { coordinator } = setup();
    expect(coordinator.shouldCloseEditorTools("projectSearch")).toBe(false);
    expect(coordinator.shouldCloseEditorTools("sessionList")).toBe(false);
    expect(coordinator.shouldCloseEditorTools("addMultiple")).toBe(false);
    expect(coordinator.shouldCloseEditorTools("timeline")).toBe(false);
    expect(coordinator.shouldCloseEditorTools("workspaceContextMenu")).toBe(false);
  });
});

describe("createOverlayCoordinator.isAnyOverlayOpen", () => {
  it("returns false when all overlays are closed", () => {
    const { coordinator } = setup();
    expect(coordinator.isAnyOverlayOpen()).toBe(false);
  });

  it("returns true when any one overlay is open", () => {
    for (const key of Object.keys(setup().state) as Array<keyof OverlayState>) {
      const initial =
        key === "workspaceContextMenu"
          ? { workspaceContextMenu: { workspaceId: WORKSPACE_ID, x: 0, y: 0 } }
          : { [key]: true };
      const { coordinator } = setup(initial);
      expect(coordinator.isAnyOverlayOpen(), `expected true when ${key} is open`).toBe(true);
    }
  });
});

describe("createOverlayCoordinator.closeAllOnWorkspaceSwitch", () => {
  it("closes the 5 pickers", () => {
    const { state, coordinator } = setup({
      quickOpenOpen: true,
      commandPaletteOpen: true,
      headingJumpOpen: true,
      bookmarkListOpen: true,
      snippetInsertOpen: true,
    });
    coordinator.closeAllOnWorkspaceSwitch();
    expect(state.quickOpenOpen).toBe(false);
    expect(state.commandPaletteOpen).toBe(false);
    expect(state.headingJumpOpen).toBe(false);
    expect(state.bookmarkListOpen).toBe(false);
    expect(state.snippetInsertOpen).toBe(false);
  });

  it("clears the snippet-insert host identity only when snippetInsert was open", () => {
    const open = setup({ snippetInsertOpen: true });
    open.coordinator.closeAllOnWorkspaceSwitch();
    expect(open.counters.snippetHostIdentityClears).toBe(1);

    const closed = setup({ snippetInsertOpen: false });
    closed.coordinator.closeAllOnWorkspaceSwitch();
    expect(closed.counters.snippetHostIdentityClears).toBe(0);
  });

  it("does NOT close sessionList / addMultiple / timeline (pre-existing asymmetry)", () => {
    const { state, coordinator } = setup({
      sessionListOpen: true,
      addMultipleOpen: true,
      timelineOpen: true,
    });
    coordinator.closeAllOnWorkspaceSwitch();
    expect(state.sessionListOpen).toBe(true);
    expect(state.addMultipleOpen).toBe(true);
    expect(state.timelineOpen).toBe(true);
  });

  it("does NOT close the workspace context menu (pre-existing asymmetry)", () => {
    const menu = { workspaceId: WORKSPACE_ID, x: 10, y: 20 };
    const { state, coordinator } = setup({ workspaceContextMenu: menu });
    coordinator.closeAllOnWorkspaceSwitch();
    expect(state.workspaceContextMenu).toEqual(menu);
  });

  it("does NOT close projectSearch (the host cancels in-flight search separately)", () => {
    // The component-level closeAllOnWorkspaceSwitch wrapper bumps the search
    // generation and clears results / status / running, but leaves the panel
    // open. The pure-logic coordinator only handles the picker half, so it
    // must not touch projectSearchOpen.
    const { state, coordinator } = setup({ projectSearchOpen: true });
    coordinator.closeAllOnWorkspaceSwitch();
    expect(state.projectSearchOpen).toBe(true);
  });
});

describe("createOverlayCoordinator.closeMarkdownOnlyPickers", () => {
  it("closes heading jump + snippet insert when language is not markdown", () => {
    const { state, coordinator, counters } = setup({
      headingJumpOpen: true,
      snippetInsertOpen: true,
    });
    coordinator.closeMarkdownOnlyPickers("typescript");
    expect(state.headingJumpOpen).toBe(false);
    expect(state.snippetInsertOpen).toBe(false);
    expect(counters.snippetHostIdentityClears).toBe(1);
  });

  it("does nothing when language is markdown", () => {
    const { state, coordinator, counters } = setup({
      headingJumpOpen: true,
      snippetInsertOpen: true,
    });
    coordinator.closeMarkdownOnlyPickers("markdown");
    expect(state.headingJumpOpen).toBe(true);
    expect(state.snippetInsertOpen).toBe(true);
    expect(counters.snippetHostIdentityClears).toBe(0);
  });

  it("does NOT close bookmarkList (pre-existing asymmetry vs. closeAllOnWorkspaceSwitch)", () => {
    // Bookmarks exist for any document type — pinned as pre-refactor behavior.
    const { state, coordinator } = setup({
      bookmarkListOpen: true,
      headingJumpOpen: true,
      snippetInsertOpen: true,
    });
    coordinator.closeMarkdownOnlyPickers("typescript");
    expect(state.bookmarkListOpen).toBe(true);
  });

  it("does not patch state when nothing needs closing", () => {
    const { patchLog, coordinator } = setup({ headingJumpOpen: false, snippetInsertOpen: false });
    coordinator.closeMarkdownOnlyPickers("typescript");
    expect(patchLog.length).toBe(0);
  });
});

describe("createOverlayCoordinator.isPicker", () => {
  it("classifies the 5 pickers as pickers", () => {
    const { coordinator } = setup();
    expect(coordinator.isPicker("quickOpen")).toBe(true);
    expect(coordinator.isPicker("commandPalette")).toBe(true);
    expect(coordinator.isPicker("headingJump")).toBe(true);
    expect(coordinator.isPicker("bookmarkList")).toBe(true);
    expect(coordinator.isPicker("snippetInsert")).toBe(true);
  });

  it("classifies the 5 non-picker overlays as not pickers", () => {
    const { coordinator } = setup();
    expect(coordinator.isPicker("projectSearch")).toBe(false);
    expect(coordinator.isPicker("sessionList")).toBe(false);
    expect(coordinator.isPicker("addMultiple")).toBe(false);
    expect(coordinator.isPicker("timeline")).toBe(false);
    expect(coordinator.isPicker("workspaceContextMenu")).toBe(false);
  });
});
