import type { WorkspaceAgentSessionDetails } from "./workspaceAgentBackend";

/**
 * Helpers for the unified per-workspace session list (M2-T2). The list shows
 * every OpenCode session for the workspace directory, not just the ones
 * opened as SpecOps agent tabs. The raw data comes from `listSessionDetails`
 * (which forwards `?directory=` to OpenCode); these helpers sort, filter, and
 * group it for display.
 */

export type SessionListSort = "updated" | "created";

export interface SessionListItem {
  details: WorkspaceAgentSessionDetails;
  /** Stable derived key for keyed rendering. */
  key: string;
  /** OpenCode ISO timestamp used for grouping / sorting (may be null). */
  sortTimestamp: string | null;
}

export function toSessionListItem(details: WorkspaceAgentSessionDetails): SessionListItem {
  return {
    details,
    key: details.id,
    // Prefer updatedAt for "recently touched" ordering; fall back to created.
    sortTimestamp: details.updatedAt ?? details.createdAt,
  };
}

export function sortSessionList(
  items: readonly SessionListItem[],
  sort: SessionListSort,
): SessionListItem[] {
  const valueOf = (item: SessionListItem): number => {
    const ts = sort === "created" ? item.details.createdAt : item.sortTimestamp;
    if (!ts) {
      return 0;
    }
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...items].sort((a, b) => valueOf(b) - valueOf(a));
}

/**
 * Case-insensitive substring filter over title + id. Empty query returns all.
 */
export function filterSessionList(
  items: readonly SessionListItem[],
  query: string,
): SessionListItem[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) {
    return [...items];
  }
  return items.filter((item) => {
    return (
      item.details.title.toLowerCase().includes(trimmed) ||
      item.details.id.toLowerCase().includes(trimmed)
    );
  });
}

export type SessionListDateGroup = "today" | "yesterday" | "last7" | "older";

export const SESSION_LIST_DATE_GROUP_ORDER: readonly SessionListDateGroup[] = [
  "today",
  "yesterday",
  "last7",
  "older",
];

export const SESSION_LIST_DATE_GROUP_LABELS: Record<SessionListDateGroup, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  older: "Older",
};

function startOfToday(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

function resolveDateGroup(timestamp: string | null, startOfTodayMs: number): SessionListDateGroup {
  if (!timestamp) {
    return "older";
  }
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return "older";
  }
  const oneDay = 24 * 60 * 60 * 1000;
  const today = startOfTodayMs;
  if (parsed >= today) {
    return "today";
  }
  if (parsed >= today - oneDay) {
    return "yesterday";
  }
  if (parsed >= today - 7 * oneDay) {
    return "last7";
  }
  return "older";
}

export function groupSessionListByDate(
  items: readonly SessionListItem[],
  now: Date = new Date(),
): Record<SessionListDateGroup, SessionListItem[]> {
  const startOfTodayMs = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const grouped: Record<SessionListDateGroup, SessionListItem[]> = {
    today: [],
    yesterday: [],
    last7: [],
    older: [],
  };
  for (const item of items) {
    grouped[resolveDateGroup(item.sortTimestamp, startOfTodayMs)].push(item);
  }
  return grouped;
}

/**
 * Formats an ISO timestamp for the session row subtitle (e.g. "14:30", "Jun
 * 12", "2025-12-01"). Returns an empty string when the timestamp is missing
 * or unparseable.
 */
export function formatSessionListTimestamp(timestamp: string | null, now: Date = new Date()): string {
  if (!timestamp) {
    return "";
  }
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  const date = new Date(parsed);
  const startOfToday = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const oneDay = 24 * 60 * 60 * 1000;
  if (parsed >= startOfToday) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (parsed >= startOfToday - oneDay) {
    return "Yesterday";
  }
  if (parsed >= startOfToday - 7 * oneDay) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  if (parsed >= startOfToday - 365 * oneDay) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
