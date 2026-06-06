import { describe, expect, it } from "vitest";
import type { WorkspaceEntry } from "../domain/contracts";
import {
  isPointerInsideRect,
  nextWorkspaceDropIndex,
  previewWorkspaces,
} from "./workspaceRailDragController";

function testRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function workspace(id: string, rootPath: string): WorkspaceEntry {
  return {
    id,
    rootPath,
    snapshot: {
      documents: [],
      session: {
        selectedTabId: null,
        openTabs: [],
        lastActiveWindowId: "main",
        windowBounds: null,
        lastActiveAgentId: null,
      },
    },
  };
}

describe("previewWorkspaces", () => {
  it("returns source order when not dragging", () => {
    const workspaces = [workspace("ws-1", "/a"), workspace("ws-2", "/b")];
    expect(previewWorkspaces(workspaces, false, 0, 1)).toBe(workspaces);
  });

  it("moves workspace to target index while dragging", () => {
    const workspaces = [workspace("ws-1", "/a"), workspace("ws-2", "/b"), workspace("ws-3", "/c")];
    expect(previewWorkspaces(workspaces, true, 2, 0).map((entry) => entry.id)).toEqual([
      "ws-3",
      "ws-1",
      "ws-2",
    ]);
  });
});

describe("nextWorkspaceDropIndex", () => {
  it("uses vertical midpoints to choose drop index", () => {
    const workspaces = [workspace("ws-1", "/a"), workspace("ws-2", "/b"), workspace("ws-3", "/c")];
    const rects = new Map([
      ["ws-1", testRect(0, 0, 32, 32)],
      ["ws-2", testRect(0, 40, 32, 32)],
      ["ws-3", testRect(0, 80, 32, 32)],
    ]);

    expect(nextWorkspaceDropIndex(workspaces, rects, "ws-2", 10, 1)).toBe(0);
    expect(nextWorkspaceDropIndex(workspaces, rects, "ws-2", 50, 1)).toBe(1);
    expect(nextWorkspaceDropIndex(workspaces, rects, "ws-2", 100, 1)).toBe(2);
  });

  it("returns fallback when no rects are available", () => {
    const workspaces = [workspace("ws-1", "/a"), workspace("ws-2", "/b")];
    expect(nextWorkspaceDropIndex(workspaces, new Map(), "ws-1", 20, 0)).toBe(0);
  });
});

describe("isPointerInsideRect", () => {
  it("detects pointer position inside a rect", () => {
    const rect = testRect(10, 20, 40, 50);
    expect(isPointerInsideRect(15, 25, rect)).toBe(true);
    expect(isPointerInsideRect(5, 25, rect)).toBe(false);
    expect(isPointerInsideRect(15, 80, rect)).toBe(false);
  });
});
