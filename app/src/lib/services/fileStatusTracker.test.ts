import { describe, expect, it } from "vitest";
import {
  fileStatusBadgeLabel,
  resolveAbsoluteStatusMap,
  summarizeFileStatuses,
} from "./fileStatusTracker";

/**
 * M5-T3 — file-status tracker pure helpers: relative→absolute path
 * resolution, badge labels, and status counts. (The store / refresh path is
 * backend-mediated and covered separately.)
 */
describe("fileStatusTracker", () => {
  describe("resolveAbsoluteStatusMap", () => {
    it("resolves workspace-relative paths to absolute paths", () => {
      const map = resolveAbsoluteStatusMap("/repo", [
        { path: "src/a.ts", additions: 1, deletions: 0, status: "modified" },
        { path: "src/new.ts", additions: 5, deletions: 0, status: "added" },
      ]);
      expect(map.get("/repo/src/a.ts")).toBe("modified");
      expect(map.get("/repo/src/new.ts")).toBe("added");
    });

    it("passes absolute paths through unchanged", () => {
      const map = resolveAbsoluteStatusMap("/repo", [
        { path: "/abs/x.ts", additions: 0, deletions: 1, status: "deleted" },
      ]);
      expect(map.get("/abs/x.ts")).toBe("deleted");
    });

    it("drops empty paths", () => {
      const map = resolveAbsoluteStatusMap("/repo", [
        { path: "  ", additions: 0, deletions: 0, status: "modified" },
        { path: "ok", additions: 0, deletions: 0, status: "modified" },
      ]);
      expect(map.size).toBe(1);
      expect(map.has("/repo/ok")).toBe(true);
    });

    it("keeps the last entry for duplicate paths", () => {
      const map = resolveAbsoluteStatusMap("/repo", [
        { path: "a", additions: 0, deletions: 0, status: "modified" },
        { path: "a", additions: 0, deletions: 0, status: "added" },
      ]);
      expect(map.get("/repo/a")).toBe("added");
    });

    it("strips trailing slashes from the workspace root", () => {
      const map = resolveAbsoluteStatusMap("/repo/", [
        { path: "a", additions: 0, deletions: 0, status: "modified" },
      ]);
      expect(map.has("/repo/a")).toBe(true);
    });
  });

  describe("fileStatusBadgeLabel", () => {
    it("returns one-letter labels", () => {
      expect(fileStatusBadgeLabel("added")).toBe("A");
      expect(fileStatusBadgeLabel("deleted")).toBe("D");
      expect(fileStatusBadgeLabel("modified")).toBe("M");
    });
  });

  describe("summarizeFileStatuses", () => {
    it("counts each status and the total", () => {
      const map = new Map([
        ["/a", "modified"],
        ["/b", "modified"],
        ["/c", "added"],
        ["/d", "deleted"],
      ] as const);
      expect(summarizeFileStatuses(map)).toEqual({
        modified: 2,
        added: 1,
        deleted: 1,
        total: 4,
      });
    });

    it("returns zeros for an empty map", () => {
      expect(summarizeFileStatuses(new Map())).toEqual({
        modified: 0,
        added: 0,
        deleted: 0,
        total: 0,
      });
    });
  });
});
