import { describe, expect, it } from "vitest";
import {
  formatWorkingTreeDiffSubtitle,
  formatWorkingTreeDiffSubtitleHelp,
  formatWorkingTreeStatusCode,
  isConflictStatusCode,
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

describe("formatWorkingTreeStatusCode", () => {
  it("labels ordinary modified/added/deleted/renamed/copied codes", () => {
    expect(formatWorkingTreeStatusCode("M ")).toBe("Modified");
    expect(formatWorkingTreeStatusCode("A ")).toBe("Added");
    expect(formatWorkingTreeStatusCode("D ")).toBe("Deleted");
    expect(formatWorkingTreeStatusCode("R ")).toBe("Renamed");
    expect(formatWorkingTreeStatusCode("C ")).toBe("Copied");
  });

  it("labels untracked and modified-in-both codes", () => {
    expect(formatWorkingTreeStatusCode("??")).toBe("Untracked");
    expect(formatWorkingTreeStatusCode("MM")).toBe("Modified");
  });

  it("labels every porcelain conflict code as Conflict, not as the underlying side (M9)", () => {
    // `UD`/`DU` previously matched `.includes("D")` → "Deleted";
    // `AU`/`UA`/`AA` previously matched `.includes("A")` → "Added";
    // `DD` previously matched `.includes("D")` → "Deleted".
    for (const code of ["DD", "AU", "UD", "UA", "DU", "AA", "UU"]) {
      expect(formatWorkingTreeStatusCode(code)).toBe("Conflict");
    }
  });
});

describe("isConflictStatusCode", () => {
  it("returns true for every conflict code and false for non-conflict codes", () => {
    expect(isConflictStatusCode("DD")).toBe(true);
    expect(isConflictStatusCode("AU")).toBe(true);
    expect(isConflictStatusCode("UD")).toBe(true);
    expect(isConflictStatusCode("UA")).toBe(true);
    expect(isConflictStatusCode("DU")).toBe(true);
    expect(isConflictStatusCode("AA")).toBe(true);
    expect(isConflictStatusCode("UU")).toBe(true);

    expect(isConflictStatusCode("M ")).toBe(false);
    expect(isConflictStatusCode("A ")).toBe(false);
    expect(isConflictStatusCode("D ")).toBe(false);
    expect(isConflictStatusCode("??")).toBe(false);
    expect(isConflictStatusCode("MM")).toBe(false);
  });
});
