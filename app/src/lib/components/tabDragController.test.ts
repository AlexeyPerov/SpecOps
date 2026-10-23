import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileTab } from "../domain/contracts";
import {
  crossPaneDropIndex,
  DRAG_THRESHOLD_PX,
  pointerDragDistance,
  shouldTearOffTab,
  createTabDragController,
} from "./tabDragController";

describe("crossPaneDropIndex", () => {
  it("appends body drops after the destination pane tabs", () => {
    expect(crossPaneDropIndex(null, 3)).toBe(3);
    expect(crossPaneDropIndex(null, 0)).toBe(0);
  });

  it("keeps an explicit strip insertion index", () => {
    expect(crossPaneDropIndex(1, 3)).toBe(1);
  });
});

describe("pointerDragDistance", () => {
  it("uses 2D distance between pointer positions", () => {
    expect(pointerDragDistance(10, 10, 10, 6)).toBe(4);
    expect(pointerDragDistance(10, 10, 6, 10)).toBe(4);
    expect(pointerDragDistance(3, 4, 0, 0)).toBe(5);
  });
});

describe("shouldTearOffTab", () => {
  it("requires movement threshold when drag has not started", () => {
    expect(shouldTearOffTab(10, 20, 10, 10, false, DRAG_THRESHOLD_PX)).toBe(true);
    expect(shouldTearOffTab(10, 11, 10, 10, false, DRAG_THRESHOLD_PX)).toBe(false);
  });

  it("allows tear-off after drag threshold is met vertically", () => {
    expect(shouldTearOffTab(10, 20, 10, 10, true, DRAG_THRESHOLD_PX)).toBe(true);
  });
});

describe("tab group drops", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  function setup(onMoveToTabGroup = vi.fn()) {
    const strip = document.createElement("div");
    const tabEl = document.createElement("div");
    tabEl.dataset.tabId = "tab-1";
    tabEl.setPointerCapture = vi.fn();
    tabEl.hasPointerCapture = () => false;
    strip.append(tabEl);
    const row = document.createElement("button");
    row.dataset.tabGroupDrop = "tabs-2";
    document.body.append(strip, row);
    const elementFromPoint = vi.fn(() => row as Element);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: elementFromPoint });
    const deps = {
      getOpenTabs: () => [createFileTab("tab-1", "doc-1")],
      getTabStripEl: () => strip,
      onSelect: vi.fn(),
      onReorder: vi.fn(),
      onMoveToTabGroup,
      getWindowId: () => "main",
      notify: vi.fn(),
      onStateChange: vi.fn(),
    };
    const controller = createTabDragController(deps);
    const down = new MouseEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }) as unknown as PointerEvent;
    Object.defineProperty(down, "pointerId", { value: 1 });
    Object.defineProperty(down, "currentTarget", { value: tabEl });
    controller.pointerDown(down, createFileTab("tab-1", "doc-1"), 0);
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { clientX: x, clientY: y });
      Object.defineProperty(event, "pointerId", { value: 1 });
      window.dispatchEvent(event);
    };
    return { deps, row, pointer, elementFromPoint };
  }

  it("moves the dragged tab into the group under the pointer and clears the hover mark", () => {
    const { deps, row, pointer } = setup();
    pointer("pointermove", 200, 300);
    expect(row.classList.contains("file-drop-context-hover")).toBe(true);
    pointer("pointerup", 200, 300);
    expect(deps.onMoveToTabGroup).toHaveBeenCalledWith("tab-1", "tabs-2");
    expect(deps.onReorder).not.toHaveBeenCalled();
    expect(row.classList.contains("file-drop-context-hover")).toBe(false);
  });

  it("treats a release without dragging as a click", () => {
    const { deps, pointer } = setup();
    pointer("pointerup", 10, 10);
    expect(deps.onMoveToTabGroup).not.toHaveBeenCalled();
  });
});
