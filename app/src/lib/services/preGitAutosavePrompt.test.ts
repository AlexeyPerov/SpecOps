import { describe, expect, it } from "vitest";
import { formatPreGitAutosaveFailureLabels } from "./preGitAutosavePrompt";
import type { PreGitAutosaveFailure } from "./preGitAutosave";

describe("formatPreGitAutosaveFailureLabels", () => {
  it("uses file names and collapses long lists", () => {
    const failures: PreGitAutosaveFailure[] = [
      { documentId: "1", title: "alpha.txt", filePath: "/tmp/ws/alpha.txt", message: "x" },
      { documentId: "2", title: "beta.txt", filePath: "/tmp/ws/beta.txt", message: "x" },
      { documentId: "3", title: "gamma.txt", filePath: "/tmp/ws/gamma.txt", message: "x" },
      { documentId: "4", title: "delta.txt", filePath: "/tmp/ws/delta.txt", message: "x" },
    ];

    expect(formatPreGitAutosaveFailureLabels(failures)).toEqual([
      "alpha.txt",
      "beta.txt",
      "gamma.txt",
      "+ 1 more",
    ]);
  });

  it("shows untitled document titles without a path", () => {
    const failures: PreGitAutosaveFailure[] = [
      { documentId: "1", title: "Untitled", filePath: null, message: "cancelled" },
    ];

    expect(formatPreGitAutosaveFailureLabels(failures)).toEqual(["Untitled"]);
  });
});
