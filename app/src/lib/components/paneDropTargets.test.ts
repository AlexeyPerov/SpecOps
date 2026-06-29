import { describe, expect, it } from "vitest";
import {
  hitTestPaneRects,
  stripDropIndex,
  type PaneRectEntry,
} from "./paneDropTargets";

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

describe("stripDropIndex", () => {
  it("returns 0 for an empty strip", () => {
    expect(stripDropIndex([], 100)).toBe(0);
  });

  it("returns the index whose midpoint the pointer is left of", () => {
    const tabs = [
      { tabId: "a", rect: rect(0, 0, 100, 30) },
      { tabId: "b", rect: rect(100, 0, 100, 30) },
    ];
    // Pointer at x=40 (< midpoint 50 of tab a) → index 0.
    expect(stripDropIndex(tabs, 40)).toBe(0);
    // Pointer at x=60 (> 50, < midpoint 150 of tab b) → index 1.
    expect(stripDropIndex(tabs, 60)).toBe(1);
    // Pointer past the last midpoint → append (length).
    expect(stripDropIndex(tabs, 200)).toBe(2);
  });
});

describe("hitTestPaneRects", () => {
  function twoPanes(): PaneRectEntry[] {
    return [
      {
        paneId: "a",
        stripRect: rect(0, 0, 200, 32),
        bodyRect: rect(0, 32, 200, 200),
        tabRects: [
          { tabId: "a1", rect: rect(0, 0, 100, 32) },
          { tabId: "a2", rect: rect(100, 0, 100, 32) },
        ],
      },
      {
        paneId: "b",
        stripRect: rect(200, 0, 200, 32),
        bodyRect: rect(200, 32, 200, 200),
        tabRects: [],
      },
    ];
  }

  it("hits pane a's strip and computes a drop index", () => {
    const hit = hitTestPaneRects(60, 10, twoPanes());
    expect(hit?.paneId).toBe("a");
    expect(hit?.region).toBe("strip");
    expect(hit?.index).toBe(1); // past tab a1's midpoint (50)
  });

  it("hits pane b's strip (empty) and returns index 0", () => {
    const hit = hitTestPaneRects(250, 10, twoPanes());
    expect(hit?.paneId).toBe("b");
    expect(hit?.region).toBe("strip");
    expect(hit?.index).toBe(0);
  });

  it("hits a pane's body and returns a null index", () => {
    const hit = hitTestPaneRects(100, 100, twoPanes());
    expect(hit?.paneId).toBe("a");
    expect(hit?.region).toBe("body");
    expect(hit?.index).toBeNull();
  });

  it("returns null when no pane contains the point", () => {
    expect(hitTestPaneRects(1000, 1000, twoPanes())).toBeNull();
  });

  it("walks panes in order and returns the first strip hit (priority over body)", () => {
    const panes: PaneRectEntry[] = [
      { paneId: "a", stripRect: rect(0, 0, 400, 32), bodyRect: rect(0, 0, 400, 400), tabRects: [] },
      { paneId: "b", stripRect: rect(0, 0, 400, 32), bodyRect: rect(0, 0, 400, 400), tabRects: [] },
    ];
    // Pointer inside both panes' bodies AND both strips → strip wins, first pane wins.
    const hit = hitTestPaneRects(10, 10, panes);
    expect(hit?.paneId).toBe("a");
    expect(hit?.region).toBe("strip");
  });
});
