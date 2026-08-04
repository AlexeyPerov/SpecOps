import { describe, expect, it } from "vitest";
import {
  MAX_MOUNTED_EDITOR_CONTEXTS,
  updateMountedEditorContexts,
} from "./editorContextKeepAlive";
import type { ContextId } from "../domain/contracts";

function available(...ids: ContextId[]): ReadonlySet<ContextId> {
  return new Set(ids);
}

describe("updateMountedEditorContexts", () => {
  it("keeps the active context and the most recent parked contexts up to the bound", () => {
    const ids = available("notepad", "ws-1", "ws-2", "ws-3", "ws-4", "ws-5", "ws-6");
    let mounted: ContextId[] = [];
    for (const contextId of [
      "notepad",
      "ws-1",
      "ws-2",
      "ws-3",
      "ws-4",
      "ws-5",
      "ws-6",
    ] as ContextId[]) {
      mounted = updateMountedEditorContexts(mounted, contextId, ids);
    }

    expect(mounted).toEqual(["ws-1", "ws-2", "ws-3", "ws-4", "ws-5", "ws-6"]);
    expect(mounted).toHaveLength(MAX_MOUNTED_EDITOR_CONTEXTS);
  });

  it("moves a revisited parked context to the active end without duplication", () => {
    const ids = available("notepad", "ws-1", "ws-2");

    expect(updateMountedEditorContexts(["notepad", "ws-1", "ws-2"], "ws-1", ids)).toEqual([
      "notepad",
      "ws-2",
      "ws-1",
    ]);
  });

  it("prunes contexts that were closed while parked", () => {
    expect(
      updateMountedEditorContexts(
        ["notepad", "ws-1", "ws-2"],
        "notepad",
        available("notepad", "ws-2"),
      ),
    ).toEqual(["ws-2", "notepad"]);
  });

  it("always retains the active context when the bound is one", () => {
    expect(
      updateMountedEditorContexts(
        ["notepad", "ws-1"],
        "ws-2",
        available("notepad", "ws-1", "ws-2"),
        1,
      ),
    ).toEqual(["ws-2"]);
  });
});
