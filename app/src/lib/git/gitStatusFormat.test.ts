import { describe, expect, it } from "vitest";
import {
  formatWorkingTreeDiffSubtitle,
  formatWorkingTreeDiffSubtitleHelp,
} from "./gitStatusFormat";
import type { WorkingTreeFileEntry } from "./types";

function entry(path: string, statusCode: string): WorkingTreeFileEntry {
  return {
    path,
    statusCode,
    indexStatus: statusCode[0] ?? " ",
    workTreeStatus: statusCode[1] ?? " ",
  };
}

describe("formatWorkingTreeDiffSubtitle", () => {
  it("labels unstaged tracked diffs as compared to the last commit", () => {
    expect(formatWorkingTreeDiffSubtitle("unstaged", entry("a.txt", " M"))).toBe(
      "Unstaged changes (vs last commit)",
    );
  });

  it("keeps staged and untracked labels unchanged", () => {
    expect(formatWorkingTreeDiffSubtitle("staged", entry("a.txt", "M "))).toBe("Staged changes");
    expect(formatWorkingTreeDiffSubtitle("unstaged", entry("new.txt", "??"))).toBe(
      "Untracked file",
    );
  });
});

describe("formatWorkingTreeDiffSubtitleHelp", () => {
  it("explains unstaged diff semantics vs HEAD", () => {
    const help = formatWorkingTreeDiffSubtitleHelp("unstaged", entry("a.txt", " M"));
    expect(help).toContain("last commit");
    expect(help).toContain("staging index");
  });

  it("omits help for untracked files", () => {
    expect(formatWorkingTreeDiffSubtitleHelp("unstaged", entry("new.txt", "??"))).toBeUndefined();
  });
});
