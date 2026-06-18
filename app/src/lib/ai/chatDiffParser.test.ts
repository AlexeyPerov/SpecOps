import { describe, expect, it } from "vitest";
import {
  diffStatusBadgeLabel,
  filterSessionDiffs,
  parseHunkHeader,
  parseSessionDiffs,
  parseUnifiedDiffPatch,
  splitDiffFilePath,
  summarizeSessionDiffs,
} from "./chatDiffParser";
import type { OpencodeSessionFileDiff } from "./backends/workspaceAgentBackend";

/**
 * M5-T2 — unified-diff patch parsing + session-diff filtering / summarizing.
 * The parser walks `@@ -a,b +c,d @@` hunk headers tracking old/new line
 * numbers; added / removed / context / hunk / meta rows are emitted for the
 * viewer.
 */
describe("chatDiffParser", () => {
  describe("parseHunkHeader", () => {
    it("extracts old/new start line numbers", () => {
      expect(parseHunkHeader("@@ -1,3 +2,4 @@ context")).toEqual({
        oldStart: 1,
        newStart: 2,
      });
    });

    it("handles single-line hunks (no counts)", () => {
      expect(parseHunkHeader("@@ -5 +6 @@")).toEqual({ oldStart: 5, newStart: 6 });
    });

    it("returns null for non-hunk lines", () => {
      expect(parseHunkHeader("diff --git a/x b/x")).toBeNull();
      expect(parseHunkHeader("+++ b/x")).toBeNull();
    });
  });

  describe("parseUnifiedDiffPatch", () => {
    it("parses a patch with context, added, and removed rows", () => {
      const patch = [
        "diff --git a/x b/x",
        "index 1..2 100644",
        "--- a/x",
        "+++ b/x",
        "@@ -1,2 +1,2 @@",
        " keep",
        "-old",
        "+new",
      ].join("\n");
      const rows = parseUnifiedDiffPatch(patch);
      // First 4 lines are metadata before the hunk.
      expect(rows.slice(0, 4).every((row) => row.kind === "meta")).toBe(true);
      const hunk = rows[4]!;
      expect(hunk.kind).toBe("hunk");

      const context = rows[5]!;
      expect(context.kind).toBe("context");
      expect(context.text).toBe("keep");
      expect(context.oldLineNumber).toBe(1);
      expect(context.newLineNumber).toBe(1);

      const removed = rows[6]!;
      expect(removed.kind).toBe("removed");
      expect(removed.text).toBe("old");
      expect(removed.oldLineNumber).toBe(2);
      expect(removed.newLineNumber).toBeNull();

      const added = rows[7]!;
      expect(added.kind).toBe("added");
      expect(added.text).toBe("new");
      expect(added.oldLineNumber).toBeNull();
      expect(added.newLineNumber).toBe(2);
    });

    it("increments line numbers across multiple added/removed rows", () => {
      const patch = ["@@ -1,1 +1,3 @@", "-a", "+b", "+c", "+d"].join("\n");
      const rows = parseUnifiedDiffPatch(patch);
      // hunk header + 1 removed + 3 added
      const addedRows = rows.filter((row) => row.kind === "added");
      expect(addedRows.map((row) => row.newLineNumber)).toEqual([1, 2, 3]);
      const removedRow = rows.find((row) => row.kind === "removed");
      expect(removedRow?.oldLineNumber).toBe(1);
    });

    it("emits the no-newline marker as a meta row", () => {
      const patch = ["@@ -1,1 +1,1 @@", "-a", "\\ No newline at end of file", "+b"].join("\n");
      const rows = parseUnifiedDiffPatch(patch);
      const marker = rows.find((row) => row.kind === "meta" && row.text.startsWith("\\"));
      expect(marker).toBeTruthy();
    });

    it("returns [] for an empty patch", () => {
      expect(parseUnifiedDiffPatch("")).toEqual([]);
    });

    it("treats a blank line inside a hunk as context", () => {
      const patch = ["@@ -1,2 +1,2 @@", " a", "", "+b"].join("\n");
      const rows = parseUnifiedDiffPatch(patch);
      const blank = rows.find((row) => row.text === "" && row.kind === "context");
      expect(blank).toBeTruthy();
      expect(blank?.oldLineNumber).toBe(2);
    });
  });

  describe("parseSessionDiffs", () => {
    it("parses every file's patch in one pass", () => {
      const files: OpencodeSessionFileDiff[] = [
        {
          file: "a.ts",
          patch: "@@ -1,1 +1,1 @@\n-a\n+a\n",
          additions: 1,
          deletions: 1,
          status: "modified",
        },
        { file: "b.ts", patch: "", additions: 0, deletions: 0, status: "added" },
      ];
      const parsed = parseSessionDiffs(files);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]!.rows.length).toBeGreaterThan(0);
      expect(parsed[1]!.rows).toEqual([]);
    });
  });

  describe("filterSessionDiffs", () => {
    const files: OpencodeSessionFileDiff[] = [
      { file: "a", patch: "", additions: 0, deletions: 0, status: "modified" },
      { file: "b", patch: "", additions: 1, deletions: 0, status: "added" },
      { file: "c", patch: "", additions: 0, deletions: 1, status: "deleted" },
    ];

    it("returns all files for the 'all' filter", () => {
      expect(filterSessionDiffs(files, "all")).toHaveLength(3);
    });

    it("filters by status", () => {
      expect(filterSessionDiffs(files, "added").map((f) => f.file)).toEqual(["b"]);
      expect(filterSessionDiffs(files, "deleted").map((f) => f.file)).toEqual(["c"]);
      expect(filterSessionDiffs(files, "modified").map((f) => f.file)).toEqual(["a"]);
    });
  });

  describe("summarizeSessionDiffs", () => {
    it("sums file count, additions, and deletions", () => {
      const files: OpencodeSessionFileDiff[] = [
        { file: "a", patch: "", additions: 3, deletions: 1, status: "modified" },
        { file: "b", patch: "", additions: 5, deletions: 2, status: "added" },
      ];
      expect(summarizeSessionDiffs(files)).toEqual({ files: 2, additions: 8, deletions: 3 });
    });

    it("returns zeros for an empty list", () => {
      expect(summarizeSessionDiffs([])).toEqual({ files: 0, additions: 0, deletions: 0 });
    });
  });

  describe("diffStatusBadgeLabel", () => {
    it("returns one-letter labels", () => {
      expect(diffStatusBadgeLabel("added")).toBe("A");
      expect(diffStatusBadgeLabel("deleted")).toBe("D");
      expect(diffStatusBadgeLabel("modified")).toBe("M");
    });
  });

  describe("splitDiffFilePath", () => {
    it("splits a path into basename and directory", () => {
      expect(splitDiffFilePath("src/lib/a.ts")).toEqual({
        basename: "a.ts",
        directory: "src/lib",
      });
    });

    it("handles a bare filename", () => {
      expect(splitDiffFilePath("a.ts")).toEqual({ basename: "a.ts", directory: "" });
    });
  });
});
