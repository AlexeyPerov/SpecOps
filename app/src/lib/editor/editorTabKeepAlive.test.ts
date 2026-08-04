import { describe, expect, it } from "vitest";
import {
  MAX_LIVE_EDITOR_TABS_PER_PANE,
  partitionImmediateAndDeferred,
  updateLiveEditorTabs,
} from "./editorTabKeepAlive";

describe("updateLiveEditorTabs", () => {
  it("bounds live editors while retaining the active and most recent tabs", () => {
    const open = new Set(["a", "b", "c", "d", "e"]);
    let live: string[] = [];
    for (const active of open) {
      live = updateLiveEditorTabs(live, active, open);
    }

    expect(live).toEqual(["b", "c", "d", "e"]);
    expect(live).toHaveLength(MAX_LIVE_EDITOR_TABS_PER_PANE);
  });

  it("moves a revisited tab to the newest end without duplication", () => {
    expect(
      updateLiveEditorTabs(["a", "b", "c", "d"], "b", new Set(["a", "b", "c", "d"])),
    ).toEqual(["a", "c", "d", "b"]);
  });

  it("prunes closed and non-text tabs", () => {
    expect(updateLiveEditorTabs(["a", "b", "c"], "c", new Set(["a", "c"]))).toEqual([
      "a",
      "c",
    ]);
  });

  it("does not mount an ineligible active tab", () => {
    expect(updateLiveEditorTabs(["a", "b"], "view-tab", new Set(["a", "b"]))).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("partitionImmediateAndDeferred", () => {
  it("mounts already-mounted tabs and the active tab immediately; defers the rest", () => {
    const result = partitionImmediateAndDeferred(
      ["a", "b", "c", "d"],
      "d",
      new Set(["a"]),
    );
    expect(result.immediate).toEqual(["a", "d"]);
    expect(result.deferred).toEqual(["b", "c"]);
  });

  it("defers nothing when every desired tab is already mounted", () => {
    const result = partitionImmediateAndDeferred(
      ["a", "b"],
      "a",
      new Set(["a", "b"]),
    );
    expect(result.immediate).toEqual(["a", "b"]);
    expect(result.deferred).toEqual([]);
  });

  it("promotes the active tab to immediate even when not yet mounted", () => {
    const result = partitionImmediateAndDeferred(
      ["a", "b", "c"],
      "c",
      new Set(),
    );
    expect(result.immediate).toEqual(["c"]);
    expect(result.deferred).toEqual(["a", "b"]);
  });

  it("returns empty sets for an empty desired list", () => {
    const result = partitionImmediateAndDeferred([], null, new Set(["a"]));
    expect(result.immediate).toEqual([]);
    expect(result.deferred).toEqual([]);
  });
});
