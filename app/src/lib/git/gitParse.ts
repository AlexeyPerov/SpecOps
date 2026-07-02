/** Parsed commit row from structured `git log --format=…` output (phase 2). */
export interface ParsedCommitLine {
  sha: string;
  parents: string[];
  decorators: string;
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerName: string;
  committerEmail: string;
  committerTime: number;
  subject: string;
}

/** Parsed local branch row from `git branch -vv` output (phase 2). */
export interface ParsedBranchLine {
  isCurrent: boolean;
  name: string;
  head: string;
  upstream: string | null;
  upstreamTrack: string | null;
  subject: string;
}

import type { AheadBehindCounts } from "./types";

/** Parsed working-tree row from `git status --porcelain` output (phase 3). */
export interface ParsedStatusLine {
  indexStatus: string;
  workTreeStatus: string;
  path: string;
}

const LOG_COMMIT_FIELD_COUNT = 8;

function splitNameEmail(value: string): { name: string; email: string } {
  const separator = value.indexOf("±");
  if (separator === -1) {
    return { name: value, email: "" };
  }
  return {
    name: value.slice(0, separator),
    email: value.slice(separator + 1),
  };
}

/**
 * Parse one NUL-separated commit line from structured `git log --format=…` output.
 *
 * Format fields: `%H`, `%P`, `%D`, `%aN±%aE`, `%at`, `%cN±%cE`, `%ct`, `%s`.
 */
export function parseLogCommitLine(line: string): ParsedCommitLine | null {
  const parts = line.split("\0");
  if (parts.length !== LOG_COMMIT_FIELD_COUNT) {
    return null;
  }

  const [
    sha,
    parentsRaw,
    decorators,
    authorRaw,
    authorTimeRaw,
    committerRaw,
    committerTimeRaw,
    subject,
  ] = parts;

  const author = splitNameEmail(authorRaw);
  const committer = splitNameEmail(committerRaw);

  return {
    sha,
    parents: parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [],
    decorators,
    authorName: author.name,
    authorEmail: author.email,
    authorTime: Number.parseInt(authorTimeRaw, 10),
    committerName: committer.name,
    committerEmail: committer.email,
    committerTime: Number.parseInt(committerTimeRaw, 10),
    subject,
  };
}

/**
 * Parse `git branch --show-current` stdout.
 * Returns `null` when stdout is empty (detached HEAD).
 */
export function parseBranchShowCurrent(stdout: string): string | null {
  const trimmed = stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Parse `git rev-parse --short HEAD` stdout for detached HEAD display. */
export function parseShortHeadRef(stdout: string): string {
  return stdout.trim();
}

/**
 * Parse `git rev-parse --abbrev-ref @{upstream}` stdout.
 * Returns `null` when upstream is missing or unresolved.
 */
export function parseUpstreamRef(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed || trimmed === "HEAD") {
    return null;
  }
  return trimmed;
}

/**
 * Parse `git rev-list --left-right --count @{u}...HEAD` stdout.
 * Git prints `behind\tahead` (left = upstream-only, right = HEAD-only).
 */
export function parseAheadBehindCount(stdout: string): AheadBehindCounts | null {
  const trimmed = stdout.trim();
  const match = /^(\d+)\s+(\d+)$/.exec(trimmed);
  if (!match) {
    return null;
  }

  return {
    behind: Number.parseInt(match[1], 10),
    ahead: Number.parseInt(match[2], 10),
  };
}

/** Placeholder for phase 2 branch list parsing (`git branch -vv`). */
export function parseBranchVvLines(_stdout: string): ParsedBranchLine[] {
  return [];
}

/** Placeholder for phase 2 tag list parsing (`git tag -l`). */
export function parseTagList(_stdout: string): string[] {
  return [];
}

/** Placeholder for phase 3 porcelain status parsing (`git status --porcelain`). */
export function parseStatusPorcelain(_stdout: string): ParsedStatusLine[] {
  return [];
}
