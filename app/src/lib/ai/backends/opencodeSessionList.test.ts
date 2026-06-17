import { describe, expect, it } from "vitest";
import type { WorkspaceAgentSessionDetails } from "./workspaceAgentBackend";
import {
  SESSION_LIST_DATE_GROUP_LABELS,
  filterSessionList,
  formatSessionListTimestamp,
  groupSessionListByDate,
  sortSessionList,
  toSessionListItem,
} from "./opencodeSessionList";

function details(
  overrides: Partial<WorkspaceAgentSessionDetails> & { id: string },
): WorkspaceAgentSessionDetails {
  return {
    title: overrides.title ?? `Session ${overrides.id}`,
    createdAt: overrides.createdAt ?? "2026-06-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-01T00:00:00.000Z",
    parentId: overrides.parentId ?? null,
    shareUrl: overrides.shareUrl ?? null,
    cost: overrides.cost ?? null,
    revert: overrides.revert ?? null,
    ...overrides,
  };
}

describe("opencodeSessionList", () => {
  describe("toSessionListItem", () => {
    it("prefers updatedAt as the sort timestamp", () => {
      const item = toSessionListItem(
        details({
          id: "s1",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
        }),
      );
      expect(item.sortTimestamp).toBe("2026-06-10T00:00:00.000Z");
      expect(item.key).toBe("s1");
    });

    it("falls back to createdAt when updatedAt is missing", () => {
      const item = toSessionListItem(
        details({ id: "s1", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: null }),
      );
      expect(item.sortTimestamp).toBe("2026-06-01T00:00:00.000Z");
    });
  });

  describe("sortSessionList", () => {
    it("sorts by updatedAt descending by default", () => {
      const items = [
        toSessionListItem(details({ id: "old", updatedAt: "2026-06-01T00:00:00.000Z" })),
        toSessionListItem(details({ id: "new", updatedAt: "2026-06-10T00:00:00.000Z" })),
      ];
      const sorted = sortSessionList(items, "updated");
      expect(sorted.map((item) => item.details.id)).toEqual(["new", "old"]);
    });

    it("sorts by createdAt when requested", () => {
      const items = [
        toSessionListItem(
          details({
            id: "recently-updated",
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-10T00:00:00.000Z",
          }),
        ),
        toSessionListItem(
          details({
            id: "recently-created",
            createdAt: "2026-06-09T00:00:00.000Z",
            updatedAt: "2026-06-02T00:00:00.000Z",
          }),
        ),
      ];
      const sorted = sortSessionList(items, "created");
      expect(sorted.map((item) => item.details.id)).toEqual([
        "recently-created",
        "recently-updated",
      ]);
    });

    it("does not mutate the input array", () => {
      const items = [
        toSessionListItem(details({ id: "old", updatedAt: "2026-06-01T00:00:00.000Z" })),
        toSessionListItem(details({ id: "new", updatedAt: "2026-06-10T00:00:00.000Z" })),
      ];
      sortSessionList(items, "updated");
      expect(items.map((item) => item.details.id)).toEqual(["old", "new"]);
    });
  });

  describe("filterSessionList", () => {
    it("matches case-insensitively on title or id", () => {
      const items = [
        toSessionListItem(details({ id: "s1", title: "Fix the bug" })),
        toSessionListItem(details({ id: "s2", title: "Refactor API" })),
      ];
      const filtered = filterSessionList(items, "fix");
      expect(filtered.map((item) => item.details.id)).toEqual(["s1"]);
    });

    it("matches on the session id when the title does not contain the query", () => {
      const items = [
        toSessionListItem(details({ id: "abc-123", title: "Untitled" })),
        toSessionListItem(details({ id: "xyz-456", title: "Untitled" })),
      ];
      const filtered = filterSessionList(items, "abc");
      expect(filtered.map((item) => item.details.id)).toEqual(["abc-123"]);
    });

    it("returns all items when the query is empty or whitespace", () => {
      const items = [
        toSessionListItem(details({ id: "s1", title: "a" })),
        toSessionListItem(details({ id: "s2", title: "b" })),
      ];
      expect(filterSessionList(items, "")).toHaveLength(2);
      expect(filterSessionList(items, "   ")).toHaveLength(2);
    });
  });

  describe("groupSessionListByDate", () => {
    const now = new Date("2026-06-17T15:00:00.000Z");

    it("places sessions into today / yesterday / last7 / older buckets", () => {
      const items = [
        // today (same day in local time as `now` adjusted to local midnight)
        toSessionListItem(
          details({ id: "today", updatedAt: new Date(now.getTime() - 60_000).toISOString() }),
        ),
        // older than 7 days
        toSessionListItem(details({ id: "old", updatedAt: "2026-05-01T00:00:00.000Z" })),
      ];
      const grouped = groupSessionListByDate(items, now);
      // today bucket should contain the recent one; old one in older.
      expect(grouped.today.map((item) => item.details.id)).toContain("today");
      expect(grouped.older.map((item) => item.details.id)).toContain("old");
    });

    it("puts sessions with no timestamp into the older bucket", () => {
      const items = [
        toSessionListItem(details({ id: "nots", updatedAt: null, createdAt: null })),
      ];
      const grouped = groupSessionListByDate(items, now);
      expect(grouped.older.map((item) => item.details.id)).toEqual(["nots"]);
    });

    it("exposes a label for every group", () => {
      for (const key of ["today", "yesterday", "last7", "older"] as const) {
        expect(SESSION_LIST_DATE_GROUP_LABELS[key]).toBeTruthy();
      }
    });
  });

  describe("formatSessionListTimestamp", () => {
    it("returns an empty string for a missing or unparseable timestamp", () => {
      expect(formatSessionListTimestamp(null)).toBe("");
      expect(formatSessionListTimestamp("not-a-date")).toBe("");
    });

    it("formats a valid ISO timestamp without throwing", () => {
      const result = formatSessionListTimestamp("2026-05-01T00:00:00.000Z");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
