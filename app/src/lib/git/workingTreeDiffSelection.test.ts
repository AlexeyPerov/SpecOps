import { describe, expect, it } from "vitest";
import type { WorkingTreeFileEntry } from "./types";
import {
  findWorkingTreeEntryForDiff,
  pickDefaultWorkingTreeDiffSelection,
  resolveWorkingTreeDiffSelection,
} from "./workingTreeDiffSelection";

function entry(path: string, statusCode = " M"): WorkingTreeFileEntry {
  return {
    path,
    indexStatus: statusCode[0] ?? " ",
    workTreeStatus: statusCode[1] ?? " ",
    statusCode,
  };
}

describe("pickDefaultWorkingTreeDiffSelection", () => {
  it("prefers the first unstaged file", () => {
    expect(
      pickDefaultWorkingTreeDiffSelection(
        [entry("a.txt"), entry("b.txt")],
        [entry("c.txt")],
      ),
    ).toEqual({ path: "a.txt", source: "unstaged" });
  });

  it("falls back to the first staged file when unstaged is empty", () => {
    expect(pickDefaultWorkingTreeDiffSelection([], [entry("c.txt")])).toEqual({
      path: "c.txt",
      source: "staged",
    });
  });

  it("returns empty selection for a clean tree", () => {
    expect(pickDefaultWorkingTreeDiffSelection([], [])).toEqual({
      path: null,
      source: null,
    });
  });
});

describe("resolveWorkingTreeDiffSelection", () => {
  const unstaged = [entry("both.txt", "MM"), entry("unstaged-only.txt", " M")];
  const staged = [entry("both.txt", "MM"), entry("staged-only.txt", "M ")];

  it("keeps unstaged list context for a partially staged file", () => {
    expect(
      resolveWorkingTreeDiffSelection({
        path: "both.txt",
        source: "unstaged",
        unstaged,
        staged,
      }),
    ).toEqual({ path: "both.txt", source: "unstaged" });
  });

  it("keeps staged list context for a partially staged file", () => {
    expect(
      resolveWorkingTreeDiffSelection({
        path: "both.txt",
        source: "staged",
        unstaged,
        staged,
      }),
    ).toEqual({ path: "both.txt", source: "staged" });
  });

  it("re-resolves to unstaged when the file moved out of staged", () => {
    expect(
      resolveWorkingTreeDiffSelection({
        path: "both.txt",
        source: "staged",
        unstaged: [entry("both.txt", " M")],
        staged: [],
      }),
    ).toEqual({ path: "both.txt", source: "unstaged" });
  });

  it("re-resolves to staged when the file moved out of unstaged", () => {
    expect(
      resolveWorkingTreeDiffSelection({
        path: "both.txt",
        source: "unstaged",
        unstaged: [],
        staged: [entry("both.txt", "M ")],
      }),
    ).toEqual({ path: "both.txt", source: "staged" });
  });

  it("selects the next available file when the active path disappears", () => {
    expect(
      resolveWorkingTreeDiffSelection({
        path: "gone.txt",
        source: "unstaged",
        unstaged: [entry("next.txt")],
        staged: [],
      }),
    ).toEqual({ path: "next.txt", source: "unstaged" });
  });

  it("clears selection when the working tree becomes clean", () => {
    expect(
      resolveWorkingTreeDiffSelection({
        path: "gone.txt",
        source: "staged",
        unstaged: [],
        staged: [],
      }),
    ).toEqual({ path: null, source: null });
  });
});

describe("findWorkingTreeEntryForDiff", () => {
  const unstaged = [entry("untracked.txt", "??"), entry("changed.txt", " M")];
  const staged = [entry("changed.txt", "MM")];

  it("finds the row in the requested list", () => {
    expect(findWorkingTreeEntryForDiff("changed.txt", "staged", unstaged, staged)).toEqual(
      entry("changed.txt", "MM"),
    );
    expect(findWorkingTreeEntryForDiff("untracked.txt", "unstaged", unstaged, staged)).toEqual(
      entry("untracked.txt", "??"),
    );
  });

  it("returns null when the path is absent from the requested list", () => {
    expect(findWorkingTreeEntryForDiff("changed.txt", "unstaged", unstaged, staged)).toEqual(
      entry("changed.txt", " M"),
    );
    expect(findWorkingTreeEntryForDiff("missing.txt", "staged", unstaged, staged)).toBeNull();
  });
});
