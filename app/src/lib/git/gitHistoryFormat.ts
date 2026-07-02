import type { CommitDecorator } from "./types";

/** Default abbreviated SHA length for history list rows. */
export const SHORT_SHA_LENGTH = 7;

/** Abbreviate a full commit SHA for compact display. */
export function formatShortSha(fullSha: string, length: number = SHORT_SHA_LENGTH): string {
  const trimmed = fullSha.trim();
  if (trimmed.length <= length) {
    return trimmed;
  }
  return trimmed.slice(0, length);
}

/**
 * Format a commit author timestamp (Unix seconds) as a locale-aware relative date
 * (e.g. "2 days ago", "last week").
 */
export function formatRelativeCommitDate(
  unixSeconds: number,
  now: Date = new Date(),
): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return "";
  }

  const thenMs = unixSeconds * 1000;
  const nowMs = now.getTime();
  const diffSec = Math.round((thenMs - nowMs) / 1000);
  const absSec = Math.abs(diffSec);

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (absSec < 60) {
    return rtf.format(diffSec, "second");
  }

  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) {
    return rtf.format(diffMin, "minute");
  }

  const diffHour = Math.round(diffSec / 3600);
  if (Math.abs(diffHour) < 24) {
    return rtf.format(diffHour, "hour");
  }

  const diffDay = Math.round(diffSec / 86400);
  if (Math.abs(diffDay) < 30) {
    return rtf.format(diffDay, "day");
  }

  const diffMonth = Math.round(diffSec / (86400 * 30));
  if (Math.abs(diffMonth) < 12) {
    return rtf.format(diffMonth, "month");
  }

  const diffYear = Math.round(diffSec / (86400 * 365));
  return rtf.format(diffYear, "year");
}

/** Accessible title for a branch/tag ref badge on a commit row. */
export function commitRefBadgeTitle(ref: CommitDecorator): string {
  switch (ref.type) {
    case "tag":
      return `Tag ${ref.name}`;
    case "currentBranchHead":
      return `Current branch ${ref.name}`;
    case "localBranchHead":
      return `Branch ${ref.name}`;
    case "currentCommitHead":
      return "HEAD";
    case "remoteBranchHead":
      return `Remote branch ${ref.name}`;
  }
}
