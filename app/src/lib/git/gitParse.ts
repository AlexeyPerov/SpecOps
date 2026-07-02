import type { CommitDecorator, CommitDecoratorType, CommitSummary } from "./types";

/** Parsed commit row from structured `git log --format=…` output (phase 2). */
export interface ParsedCommitLine {
  sha: string;
  parents: string[];
  decoratorsRaw: string;
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

/** Structured NUL-separated `git log --format=…` string (phase 2 commit queries). */
export const GIT_LOG_FORMAT =
  "%H%x00%P%x00%D%x00%aN±%aE%x00%at%x00%cN±%cE%x00%ct%x00%s";

const DECORATOR_TYPE_ORDER: Record<CommitDecoratorType, number> = {
  currentBranchHead: 1,
  localBranchHead: 2,
  currentCommitHead: 3,
  remoteBranchHead: 4,
  tag: 5,
};

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
    decoratorsRaw: decorators,
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
 * Parse `%D` decorator field from `git log --decorate=full` output into branch/tag refs.
 */
export function parseCommitDecorators(raw: string): CommitDecorator[] {
  const trimmed = raw.trim();
  if (trimmed.length < 3) {
    return [];
  }

  const refs: CommitDecorator[] = [];
  for (const segment of trimmed.split(",")) {
    const decorator = segment.trim();
    if (!decorator || decorator.endsWith("/HEAD")) {
      continue;
    }

    if (decorator.startsWith("tag: refs/tags/")) {
      refs.push({ type: "tag", name: decorator.slice("tag: refs/tags/".length) });
    } else if (decorator.startsWith("HEAD -> refs/heads/")) {
      refs.push({
        type: "currentBranchHead",
        name: decorator.slice("HEAD -> refs/heads/".length),
      });
    } else if (decorator === "HEAD") {
      refs.push({ type: "currentCommitHead", name: decorator });
    } else if (decorator.startsWith("refs/heads/")) {
      refs.push({ type: "localBranchHead", name: decorator.slice("refs/heads/".length) });
    } else if (decorator.startsWith("refs/remotes/")) {
      refs.push({ type: "remoteBranchHead", name: decorator.slice("refs/remotes/".length) });
    }
  }

  refs.sort((left, right) => {
    const typeDelta = DECORATOR_TYPE_ORDER[left.type] - DECORATOR_TYPE_ORDER[right.type];
    if (typeDelta !== 0) {
      return typeDelta;
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });

  return refs;
}

function toCommitSummary(parsed: ParsedCommitLine): CommitSummary {
  return {
    sha: parsed.sha,
    parents: parsed.parents,
    refs: parseCommitDecorators(parsed.decoratorsRaw),
    authorName: parsed.authorName,
    authorEmail: parsed.authorEmail,
    authorTime: parsed.authorTime,
    committerName: parsed.committerName,
    committerEmail: parsed.committerEmail,
    committerTime: parsed.committerTime,
    subject: parsed.subject,
  };
}

/** Parse structured `git log --format=…` stdout into commits (newest-first order preserved). */
export function parseLogCommits(stdout: string): CommitSummary[] {
  const commits: CommitSummary[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parsed = parseLogCommitLine(line);
    if (parsed) {
      commits.push(toCommitSummary(parsed));
    }
  }
  return commits;
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
