import { describe, expect, it, vi } from "vitest";
import {
  createProjectTreeDragController,
  PROJECT_TREE_DRAG_THRESHOLD_PX,
  type ProjectTreeDragState,
} from "./projectTreeDrag";
import type { ProjectTreeNode } from "../services/projectTree";
import type { PaneDropTargetElements } from "./paneDropTargets";

function fileNode(path: string): ProjectTreeNode {
  return { kind: "file", path, name: path.split("/").pop() ?? path };
}

function dirNode(path: string): ProjectTreeNode {
  return { kind: "directory", path, name: path.split("/").pop() ?? path };
}

function createController(options: {
  getWorkspaceRoot?: () => string | null;
  getPaneElements?: () => PaneDropTargetElements[];
  getDropTargetElements?: () => HTMLElement[];
  onOpenFileInPane?: (filePath: string, paneId: string) => void | Promise<void>;
  onMove?: (sourcePath: string, destDirPath: string) => Promise<void>;
} = {}) {
  let state: ProjectTreeDragState | null = null;
  const notify = vi.fn();
  const controller = createProjectTreeDragController({
    getWorkspaceRoot: options.getWorkspaceRoot ?? (() => "/root"),
    onMove: options.onMove ?? vi.fn(),
    notify,
    getPaneElements: options.getPaneElements,
    getDropTargetElements: options.getDropTargetElements,
    onOpenFileInPane: options.onOpenFileInPane,
    onStateChange: (next) => {
      state = next;
    },
  });
  return { controller, getState: () => state, notify };
}

function dragPastThreshold(controller: ReturnType<typeof createController>["controller"], node: ProjectTreeNode): void {
  const downEvent = {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
  } as PointerEvent;
  expect(controller.handlePointerDown(downEvent, node)).toBe(true);
  const moveEvent = {
    pointerId: 1,
    clientX: PROJECT_TREE_DRAG_THRESHOLD_PX + 1,
    clientY: 0,
  } as PointerEvent;
  controller.handlePointerMove(moveEvent);
}

describe("projectTreeDrag — file→pane drop (Phase 6)", () => {
  it("calls onOpenFileInPane when a file drag lands on a pane", async () => {
    const onOpenFileInPane = vi.fn();
    const paneBody = document.createElement("div");
    // jsdom doesn't compute layout, so stub the rect explicitly.
    paneBody.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 100,
        right: 300,
        bottom: 300,
        width: 200,
        height: 200,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(paneBody);
    try {
      const { controller } = createController({
        getPaneElements: () => [{ paneId: "pane-1", stripEl: null, bodyEl: paneBody }],
        onOpenFileInPane,
      });
      controller.handlePointerDown(
        { button: 0, pointerId: 1, clientX: 0, clientY: 0 } as PointerEvent,
        fileNode("/root/a.txt"),
      );
      // Move past threshold, then over the pane body.
      controller.handlePointerMove({
        pointerId: 1,
        clientX: PROJECT_TREE_DRAG_THRESHOLD_PX + 1,
        clientY: 0,
      } as PointerEvent);
      controller.handlePointerMove({
        pointerId: 1,
        clientX: 150,
        clientY: 150,
      } as PointerEvent);
      const consumed = await controller.finishDrop();
      expect(consumed).toBe(true);
      expect(onOpenFileInPane).toHaveBeenCalledWith("/root/a.txt", "pane-1");
    } finally {
      paneBody.remove();
    }
  });

  it("does not drop into a pane when no pane is hit (file not moved)", async () => {
    const onOpenFileInPane = vi.fn();
    const { controller } = createController({
      getPaneElements: () => [{ paneId: "pane-1", stripEl: null, bodyEl: null }],
      onOpenFileInPane,
    });
    dragPastThreshold(controller, fileNode("/root/a.txt"));
    const consumed = await controller.finishDrop();
    expect(consumed).toBe(false);
    expect(onOpenFileInPane).not.toHaveBeenCalled();
  });

  it("does not initiate a pane drop for a folder node (folders move between dirs)", async () => {
    const onOpenFileInPane = vi.fn();
    const onMove = vi.fn();
    const { controller } = createController({
      getPaneElements: () => [{ paneId: "pane-1", stripEl: null, bodyEl: null }],
      onOpenFileInPane,
      onMove,
    });
    dragPastThreshold(controller, dirNode("/root/sub"));
    const consumed = await controller.finishDrop();
    // No folder target and a directory source → no-op (no pane drop).
    expect(consumed).toBe(false);
    expect(onOpenFileInPane).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does not drop into a pane when the drag threshold was not crossed (a click)", async () => {
    const onOpenFileInPane = vi.fn();
    const { controller } = createController({
      getPaneElements: () => [{ paneId: "pane-1", stripEl: null, bodyEl: null }],
      onOpenFileInPane,
    });
    // pointerdown only (no move past threshold) — simulates a click.
    controller.handlePointerDown(
      { button: 0, pointerId: 1, clientX: 0, clientY: 0 } as PointerEvent,
      fileNode("/root/a.txt"),
    );
    const consumed = await controller.finishDrop();
    expect(consumed).toBe(false);
    expect(onOpenFileInPane).not.toHaveBeenCalled();
  });

  it("ignores right-button pointerdown (no drag initiated)", async () => {
    const { controller, getState } = createController();
    const accepted = controller.handlePointerDown(
      { button: 2, pointerId: 1, clientX: 0, clientY: 0 } as PointerEvent,
      fileNode("/root/a.txt"),
    );
    // Caller must not attach window listeners when the press is rejected (M63).
    expect(accepted).toBe(false);
    // No state change emitted on right-button → state stays at its initial null.
    expect(getState()?.sourcePath ?? null).toBeNull();
  });
});

describe("projectTreeDrag — folder drop still takes priority", () => {
  it("moves a file into a folder when a folder drop target is set, even with panes present", async () => {
    const onMove = vi.fn();
    const onOpenFileInPane = vi.fn();
    const { controller } = createController({
      getPaneElements: () => [
        { paneId: "pane-1", stripEl: null, bodyEl: null },
      ],
      onMove,
      onOpenFileInPane,
    });
    dragPastThreshold(controller, fileNode("/root/a.txt"));
    controller.setDropTarget("/root/sub");
    const consumed = await controller.finishDrop();
    expect(consumed).toBe(true);
    expect(onMove).toHaveBeenCalledWith("/root/a.txt", "/root/sub");
    expect(onOpenFileInPane).not.toHaveBeenCalled();
  });
});

/**
 * Coordinate-based folder drop-target acquisition. Without this path the
 * controller relied on element boundary events (`pointerenter`/`pointerleave`),
 * which the implicit pointer capture of an active mouse drag suppresses — so
 * dragging a file onto a folder was a silent no-op. These tests exercise the
 * coordinate hit-test that resolves folder targets from directory-row rects.
 */
describe("projectTreeDrag — folder drop via coordinate hit-test", () => {
  function createDirElement(path: string, rect: { left: number; top: number; right: number; bottom: number }): HTMLElement {
    const el = document.createElement("button");
    el.dataset.path = path;
    el.dataset.treeKind = "directory";
    el.getBoundingClientRect = () =>
      ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
      }) as DOMRect;
    return el;
  }

  it("acquires the folder drop target by coordinates during a drag and moves the file on drop", async () => {
    const onMove = vi.fn();
    const folderEl = createDirElement("/root/sub", { left: 50, top: 50, right: 250, bottom: 80 });
    const { controller } = createController({
      getDropTargetElements: () => [folderEl],
      onMove,
    });
    controller.handlePointerDown(
      { button: 0, pointerId: 1, clientX: 0, clientY: 0 } as PointerEvent,
      fileNode("/root/a.txt"),
    );
    // Move past threshold to enter the dragging state.
    controller.handlePointerMove({
      pointerId: 1,
      clientX: PROJECT_TREE_DRAG_THRESHOLD_PX + 1,
      clientY: 0,
    } as PointerEvent);
    // Move over the folder rect — the controller must hit-test and acquire it.
    controller.handlePointerMove({
      pointerId: 1,
      clientX: 150,
      clientY: 65,
    } as PointerEvent);
    const consumed = await controller.finishDrop();
    expect(consumed).toBe(true);
    expect(onMove).toHaveBeenCalledWith("/root/a.txt", "/root/sub");
  });

  it("does not acquire a folder target when the pointer is not over any directory row", async () => {
    const onMove = vi.fn();
    const folderEl = createDirElement("/root/sub", { left: 50, top: 50, right: 250, bottom: 80 });
    const { controller } = createController({
      getDropTargetElements: () => [folderEl],
      onMove,
    });
    dragPastThreshold(controller, fileNode("/root/a.txt"));
    // Pointer is well outside the folder rect.
    controller.handlePointerMove({
      pointerId: 1,
      clientX: 500,
      clientY: 500,
    } as PointerEvent);
    const consumed = await controller.finishDrop();
    expect(consumed).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });
});
