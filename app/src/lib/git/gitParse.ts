import type {
  BranchSummary,
  CommitDecorator,
  CommitDecoratorType,
  CommitDetail,
  CommitFileChange,
  CommitFileStatus,
  CommitSummary,
  GitRemote,
  GitStashSummary,
  GitTagSummary,
  WorkingTreeFileEntry,
  WorkingTreeStatus,
} from "./types";
import { normalizeGitOutputPath } from "./types";

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

/** Structured NUL-separated `git show --format=…` prefix (phase 2 commit detail). */
export const GIT_SHOW_FORMAT =
  "%H%x00%P%x00%aN%x00%aE%x00%at%x00%cN%x00%cE%x00%ct%x00%B";

const COMMIT_SHOW_METADATA_FIELD_COUNT = 8;
const NAME_STATUS_LINE = /^[ADMRCTU]\d*\t/;

function isNameStatusLine(line: string): boolean {
  return NAME_STATUS_LINE.test(line);
}

function parseUpstreamBracket(content: string): { upstream: string | null; track: string | null } {
  const trimmed = content.trim();
  if (!trimmed) {
    return { upstream: null, track: null };
  }

  const colon = trimmed.indexOf(":");
  if (colon === -1) {
    return { upstream: trimmed, track: null };
  }

  return {
    upstream: trimmed.slice(0, colon).trim() || null,
    track: trimmed.slice(colon + 1).trim() || null,
  };
}

function normalizeRepoRelativePath(path: string): string {
  return normalizeGitOutputPath(unquotePorcelainPath(path));
}

function parseNameStatusLine(line: string): CommitFileChange | null {
  const renameOrCopy = /^([RC])(\d+)\t([^\t]+)\t(.+)$/.exec(line);
  if (renameOrCopy) {
    return {
      status: renameOrCopy[1] as CommitFileStatus,
      previousPath: normalizeRepoRelativePath(renameOrCopy[3]),
      path: normalizeRepoRelativePath(renameOrCopy[4]),
    };
  }

  const simple = /^([ADMTUX])\t(.+)$/.exec(line);
  if (simple) {
    return {
      status: simple[1] as CommitFileStatus,
      path: normalizeRepoRelativePath(simple[2]),
    };
  }

  return null;
}

function splitCommitShowSections(stdout: string): { metadataRaw: string; fileLines: string[] } {
  const lines = stdout.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end -= 1;
  }

  let fileStart = end;
  while (fileStart > 0 && isNameStatusLine(lines[fileStart - 1] ?? "")) {
    fileStart -= 1;
  }

  return {
    metadataRaw: lines.slice(0, fileStart).join("\n"),
    fileLines: lines.slice(fileStart, end),
  };
}

function parseCommitShowMetadata(raw: string): Omit<CommitDetail, "files"> | null {
  let pos = 0;
  const fields: string[] = [];

  for (let index = 0; index < COMMIT_SHOW_METADATA_FIELD_COUNT; index += 1) {
    const next = raw.indexOf("\0", pos);
    if (next === -1) {
      return null;
    }
    fields.push(raw.slice(pos, next));
    pos = next + 1;
  }

  const message = raw.slice(pos).replace(/\n$/, "");
  const [
    sha,
    parentsRaw,
    authorName,
    authorEmail,
    authorTimeRaw,
    committerName,
    committerEmail,
    committerTimeRaw,
  ] = fields;

  return {
    sha,
    parents: parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [],
    authorName,
    authorEmail,
    authorTime: Number.parseInt(authorTimeRaw, 10),
    committerName,
    committerEmail,
    committerTime: Number.parseInt(committerTimeRaw, 10),
    message,
  };
}

/** Parse one `git branch -vv` line into a branch row. */
export function parseBranchVvLine(line: string): ParsedBranchLine | null {
  const trimmed = line.trimEnd();
  if (!trimmed) {
    return null;
  }

  const match =
    /^(\*|\s)\s(\S+)\s+([0-9a-fA-F]+)(?:\s+\[([^\]]*)\])?(?:\s+(.*))?$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const upstreamInfo = match[4] ? parseUpstreamBracket(match[4]) : { upstream: null, track: null };

  return {
    isCurrent: match[1] === "*",
    name: match[2],
    head: match[3],
    upstream: upstreamInfo.upstream,
    upstreamTrack: upstreamInfo.track,
    subject: match[5]?.trim() ?? "",
  };
}

/** Parse `git branch -vv` stdout into local branch rows. */
export function parseBranchVvLines(stdout: string): BranchSummary[] {
  const branches: BranchSummary[] = [];
  for (const line of stdout.split("\n")) {
    const parsed = parseBranchVvLine(line);
    if (parsed) {
      branches.push(parsed);
    }
  }
  return branches;
}

/** Parse `git show --name-status --format=…` stdout into commit detail. */
export function parseCommitShow(stdout: string): CommitDetail | null {
  const { metadataRaw, fileLines } = splitCommitShowSections(stdout);
  const metadata = parseCommitShowMetadata(metadataRaw);
  if (!metadata) {
    return null;
  }

  const files: CommitFileChange[] = [];
  for (const line of fileLines) {
    const parsed = parseNameStatusLine(line);
    if (parsed) {
      files.push(parsed);
    }
  }

  return {
    ...metadata,
    files,
  };
}

/** Parse `git tag -l` stdout into alphabetically sorted tag names. */
export function parseTagList(stdout: string): string[] {
  const tags = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return tags.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

/** NUL-separated `git stash list --format=…` field layout (D-07). */
export const GIT_STASH_LIST_FORMAT = "%H%n%P%n%ct%n%gd%n%B";

/**
 * Parse one NUL-delimited stash entry from `git stash list -z --format=…`.
 * Expects `%H`, `%P`, `%ct`, `%gd`, then `%B` message body.
 */
export function parseStashListItem(item: string): GitStashSummary | null {
  const trimmed = item.trim();
  if (!trimmed) {
    return null;
  }

  const fieldLines: string[] = [];
  let start = 0;
  for (let fieldIndex = 0; fieldIndex < 4; fieldIndex += 1) {
    const end = trimmed.indexOf("\n", start);
    if (end === -1) {
      if (fieldIndex < 3) {
        return null;
      }
      fieldLines.push(trimmed.slice(start));
      start = trimmed.length;
      break;
    }
    fieldLines.push(trimmed.slice(start, end));
    start = end + 1;
  }

  if (fieldLines.length < 4) {
    return null;
  }

  const sha = fieldLines[0]?.trim() ?? "";
  const parentsRaw = fieldLines[1]?.trim() ?? "";
  const createdAtRaw = fieldLines[2]?.trim() ?? "";
  const ref = fieldLines[3]?.trim() ?? "";
  if (!sha || !ref) {
    return null;
  }

  const createdAt = Number.parseInt(createdAtRaw, 10);
  if (Number.isNaN(createdAt)) {
    return null;
  }

  const parents =
    parentsRaw.length > 0 ? parentsRaw.split(/\s+/).filter(Boolean) : [];
  const message =
    start < trimmed.length ? trimmed.slice(start).replace(/^\n/, "").trimEnd() : "";

  return {
    sha,
    parents,
    ref,
    createdAt,
    message,
  };
}

/** Parse `git stash list -z --format=…` stdout into rows (newest first). */
export function parseStashList(stdout: string): GitStashSummary[] {
  if (!stdout.trim()) {
    return [];
  }

  const rows: GitStashSummary[] = [];
  for (const item of stdout.split("\0")) {
    const parsed = parseStashListItem(item);
    if (parsed) {
      rows.push(parsed);
    }
  }
  return rows;
}

export interface ParsedRemoteVvLine {
  name: string;
  url: string;
  kind: "fetch" | "push";
}

/** Parse one line from `git remote -v` stdout. */
export function parseRemoteVvLine(line: string): ParsedRemoteVvLine | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
  if (!match) {
    return null;
  }

  return {
    name: match[1] ?? "",
    url: match[2] ?? "",
    kind: match[3] as "fetch" | "push",
  };
}

/** Parse `git remote -v` stdout into remotes sorted by name. */
export function parseRemoteVvLines(stdout: string): GitRemote[] {
  const byName = new Map<string, { fetchUrl: string | null; pushUrl: string | null }>();

  for (const line of stdout.split("\n")) {
    const parsed = parseRemoteVvLine(line);
    if (!parsed) {
      continue;
    }

    let entry = byName.get(parsed.name);
    if (!entry) {
      entry = { fetchUrl: null, pushUrl: null };
      byName.set(parsed.name, entry);
    }

    if (parsed.kind === "fetch") {
      entry.fetchUrl = parsed.url;
    } else {
      entry.pushUrl = parsed.url;
    }
  }

  return Array.from(byName.entries())
    .map(([name, urls]) => ({
      name,
      fetchUrl: urls.fetchUrl,
      pushUrl: urls.pushUrl,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

/** Parse `git ls-remote --tags <remote>` stdout into sorted tag names. */
export function parseLsRemoteTags(stdout: string): string[] {
  const tags = new Set<string>();

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const tabIndex = trimmed.indexOf("\t");
    if (tabIndex === -1) {
      continue;
    }

    const ref = trimmed.slice(tabIndex + 1).trim();
    if (!ref.startsWith("refs/tags/")) {
      continue;
    }

    let tagName = ref.slice("refs/tags/".length);
    if (tagName.endsWith("^{}")) {
      tagName = tagName.slice(0, -3);
    }

    if (tagName) {
      tags.add(tagName);
    }
  }

  return Array.from(tags).sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

/** Prefer `origin`, otherwise the first configured remote. */
export function resolveDefaultRemote(remotes: GitRemote[]): GitRemote | null {
  if (remotes.length === 0) {
    return null;
  }

  return remotes.find((remote) => remote.name === "origin") ?? remotes[0] ?? null;
}

/** Mark local tags that also appear on the default remote. */
export function mergeTagRemotePresence(
  localTags: string[],
  remoteTagNames: string[],
): GitTagSummary[] {
  const remoteSet = new Set(remoteTagNames);

  return localTags.map((name) => ({
    name,
    ...(remoteSet.has(name) ? { onRemote: true } : {}),
  }));
}

function decodeGitQuotedPath(inner: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]!;
    if (char !== "\\" || index + 1 >= inner.length) {
      bytes.push(char.charCodeAt(0));
      continue;
    }

    const next = inner[index + 1]!;
    switch (next) {
      case "n":
        bytes.push(0x0a);
        index += 1;
        continue;
      case "t":
        bytes.push(0x09);
        index += 1;
        continue;
      case "r":
        bytes.push(0x0d);
        index += 1;
        continue;
      case '"':
        bytes.push(0x22);
        index += 1;
        continue;
      case "\\":
        bytes.push(0x5c);
        index += 1;
        continue;
      default: {
        const octalMatch = /^[0-7]{1,3}/.exec(inner.slice(index + 1));
        if (octalMatch) {
          bytes.push(Number.parseInt(octalMatch[0], 8));
          index += octalMatch[0].length;
          continue;
        }
        bytes.push(0x5c);
        continue;
      }
    }
  }

  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

function unquotePorcelainPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return decodeGitQuotedPath(trimmed.slice(1, -1));
  }
  return trimmed;
}

function parsePorcelainPathPart(pathPart: string): string {
  const unquoted = unquotePorcelainPath(pathPart);
  const arrowMatch = /^(.+?) -> (.+)$/.exec(unquoted);
  if (arrowMatch) {
    return normalizeRepoRelativePath(unquotePorcelainPath(arrowMatch[2]));
  }

  const tabIndex = unquoted.indexOf("\t");
  if (tabIndex !== -1) {
    return normalizeRepoRelativePath(unquotePorcelainPath(unquoted.slice(tabIndex + 1)));
  }

  return normalizeRepoRelativePath(unquoted);
}

/** Parse `git status --porcelain` v1 stdout into working-tree rows. */
export function parseStatusPorcelain(stdout: string): ParsedStatusLine[] {
  const lines: ParsedStatusLine[] = [];

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.length < 3 || line[2] !== " ") {
      continue;
    }

    const indexStatus = line[0] ?? " ";
    const workTreeStatus = line[1] ?? " ";
    const path = parsePorcelainPathPart(line.slice(3));

    if (!path) {
      continue;
    }

    lines.push({ indexStatus, workTreeStatus, path });
  }

  return lines;
}

/** Split parsed porcelain rows into staged and unstaged file lists. */
export function splitWorkingTreeStatus(lines: ParsedStatusLine[]): WorkingTreeStatus {
  const staged: WorkingTreeFileEntry[] = [];
  const unstaged: WorkingTreeFileEntry[] = [];

  for (const line of lines) {
    const { indexStatus, workTreeStatus, path } = line;
    const statusCode = `${indexStatus}${workTreeStatus}`;

    if (indexStatus !== " " && indexStatus !== "?") {
      staged.push({
        path,
        indexStatus,
        workTreeStatus,
        statusCode,
      });
    }

    const isUntracked = indexStatus === "?" && workTreeStatus === "?";
    if (isUntracked || (workTreeStatus !== " " && workTreeStatus !== "?")) {
      unstaged.push({
        path,
        indexStatus,
        workTreeStatus,
        statusCode: isUntracked ? "??" : statusCode,
      });
    }
  }

  const sortByPath = (left: WorkingTreeFileEntry, right: WorkingTreeFileEntry): number =>
    left.path.localeCompare(right.path, undefined, { sensitivity: "base" });

  return {
    staged: staged.sort(sortByPath),
    unstaged: unstaged.sort(sortByPath),
  };
}
