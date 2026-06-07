import { describe, expect, it } from "vitest";
import {
  computeWorkspaceReorderTarget,
  findWorkspaceIndex,
  resolveCloseWorkspaceAction,
} from "./workspaceContextMenuController";

describe("resolveCloseWorkspaceAction", () => {
  it("returns discard-all when there are no dirty documents", () => {
    expect(
      resolveCloseWorkspaceAction(0, {
        confirmSaveAll: () => true,
        confirmDiscardAll: () => true,
      }),
    ).toBe("discard-all");
  });

  it("returns save-all when the user accepts save all", () => {
    expect(
      resolveCloseWorkspaceAction(2, {
        confirmSaveAll: (count) => {
          expect(count).toBe(2);
          return true;
        },
        confirmDiscardAll: () => {
          throw new Error("discard prompt should not run");
        },
      }),
    ).toBe("save-all");
  });

  it("returns discard-all when save all is declined and discard is accepted", () => {
    expect(
      resolveCloseWorkspaceAction(1, {
        confirmSaveAll: () => false,
        confirmDiscardAll: () => true,
      }),
    ).toBe("discard-all");
  });

  it("returns cancel when both prompts are declined", () => {
    expect(
      resolveCloseWorkspaceAction(3, {
        confirmSaveAll: () => false,
        confirmDiscardAll: () => false,
      }),
    ).toBe("cancel");
  });
});

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
