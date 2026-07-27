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
import { isWindows } from "../services/platform";
import { isConflictStatusCode } from "./gitStatusFormat";

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

/** Parsed branch header from the first line of `git status -sb` output. */
export type ParsedStatusShortBranch = {
  branchName: string;
  isDetached: boolean;
  upstream: string | null;
  aheadBehind: AheadBehindCounts | null;
  /**
   * True when `git status -sb` reports `## No commits yet on <branch>` — an
   * unborn HEAD. Without this flag the header is parsed as a literal branch
   * name of "No commits yet on main", leaking the placeholder into the UI.
   */
  isUnborn: boolean;
};

function parseStatusShortTrackCounts(track: string): AheadBehindCounts | null {
  const aheadMatch = /ahead (\d+)/.exec(track);
  const behindMatch = /behind (\d+)/.exec(track);
  if (!aheadMatch && !behindMatch) {
    return null;
  }

  return {
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1], 10) : 0,
  };
}

/**
 * Parse the `## …` branch header from `git status -sb` stdout.
 * Returns `null` when the line is missing or unrecognizable.
 */
export function parseStatusShortBranchHeader(line: string): ParsedStatusShortBranch | null {
  const match = /^## (.+)$/.exec(line.trim());
  if (!match) {
    return null;
  }

  const body = match[1];
  if (body === "HEAD (no branch)") {
    return {
      branchName: "",
      isDetached: true,
      upstream: null,
      aheadBehind: null,
      isUnborn: false,
    };
  }

  // `git status -sb` emits `## No commits yet on <branch>` for an unborn HEAD
  // (a freshly `git init`-ed repo with no commits). Parsing it through the
  // generic branch-name path would treat the whole sentence as the branch
  // name. Pull out the real branch name and flag the unborn state so callers
  // can render their dedicated empty state instead.
  const unbornMatch = /^No commits yet on (.+)$/.exec(body);
  if (unbornMatch) {
    return {
      branchName: unbornMatch[1].trim(),
      isDetached: false,
      upstream: null,
      aheadBehind: null,
      isUnborn: true,
    };
  }

  const bracketMatch = / \[([^\]]+)\]$/.exec(body);
  const bracketContent = bracketMatch ? bracketMatch[1] : null;
  const branchPart = bracketMatch ? body.slice(0, bracketMatch.index) : body;

  const ellipsisIndex = branchPart.indexOf("...");
  const branchName = ellipsisIndex === -1 ? branchPart : branchPart.slice(0, ellipsisIndex);
  const upstream =
    ellipsisIndex === -1 ? null : branchPart.slice(ellipsisIndex + 3).trim() || null;

  let aheadBehind: AheadBehindCounts | null = null;
  if (bracketContent && bracketContent !== "gone") {
    aheadBehind = parseStatusShortTrackCounts(bracketContent);
  }

  return {
    branchName,
    isDetached: false,
    upstream,
    aheadBehind,
    isUnborn: false,
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

/**
 * Normalize a path taken verbatim from NUL-delimited (`-z`) porcelain v2
 * output. Unlike {@link normalizeRepoRelativePath}, this MUST NOT unquote,
 * unescape, or `.trim()` — `-z` paths are emitted raw, so a leading/trailing
 * space, a tab, or a backslash is a literal part of the filename. Stripping
 * them produces a path that doesn't exist on disk and can't be staged/diffed.
 *
 * Only the Windows `\`→`/` separator rewrite is applied, plus a trailing-slash
 * collapse (porcelain paths never carry a meaningful trailing slash). Note
 * this intentionally bypasses {@link normalizeGitOutputPath}, which `.trim()`s
 * — that trim is correct for line-oriented output but loses significant
 * whitespace inside a raw NUL-delimited segment.
 */
function normalizeRawV2Path(path: string): string {
  let normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (isWindows()) {
    normalized = normalized.replace(
      /^([A-Za-z]):\//,
      (_, drive: string) => `${drive.toLowerCase()}:/`,
    );
  }
  return normalized;
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

  // Marker column: `*` = current branch, ` ` = ordinary branch, `+` = checked
  // out in a linked worktree (otherwise silently dropped — see M3). Each is
  // followed by a single space, then the branch name.
  const markerMatch = /^(\*|\+|\s)\s/.exec(trimmed);
  if (!markerMatch) {
    return null;
  }

  const body = trimmed.slice(markerMatch[0].length);
  const hashMatch = /\s([0-9a-fA-F]{7,40})(?=\s+\[|\s+[^\s\[]|\s*$)/.exec(body);
  if (!hashMatch || hashMatch.index === undefined) {
    return null;
  }

  const name = body.slice(0, hashMatch.index).trimEnd();
  if (!name) {
    return null;
  }

  const head = hashMatch[1];
  let tail = body.slice(hashMatch.index + hashMatch[0].length).trimStart();

  let upstream: string | null = null;
  let upstreamTrack: string | null = null;

  // A branch checked out in a linked worktree carries a `(/path/to/worktree)`
  // annotation where the upstream bracket normally sits. That parenthesised
  // path is not an upstream ref — skip it and continue scanning for a real
  // `[upstream: track]` bracket further along the line.
  if (tail.startsWith("(")) {
    const closingParen = tail.indexOf(")");
    if (closingParen === -1) {
      return null;
    }
    tail = tail.slice(closingParen + 1).trimStart();
  }

  if (tail.startsWith("[")) {
    const closingBracket = tail.indexOf("]");
    if (closingBracket === -1) {
      return null;
    }
    const upstreamInfo = parseUpstreamBracket(tail.slice(1, closingBracket));
    upstream = upstreamInfo.upstream;
    upstreamTrack = upstreamInfo.track;
    tail = tail.slice(closingBracket + 1).trimStart();
  }

  return {
    isCurrent: markerMatch[1] === "*",
    name,
    head,
    upstream,
    upstreamTrack,
    subject: tail.trim(),
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

function mapPorcelainV2StatusChar(char: string): string {
  return char === "." ? " " : char;
}

function mapPorcelainV2XY(xy: string): { indexStatus: string; workTreeStatus: string } {
  return {
    indexStatus: mapPorcelainV2StatusChar(xy[0] ?? " "),
    workTreeStatus: mapPorcelainV2StatusChar(xy[1] ?? " "),
  };
}

function pushParsedStatusLine(
  lines: ParsedStatusLine[],
  xy: string,
  path: string,
): void {
  // `-z` output is NUL-delimited, so paths are emitted raw (unquoted, with
  // literal whitespace/backslashes). Treat them verbatim — only the Windows
  // separator rewrite in `normalizeRawV2Path` is applied.
  const normalizedPath = normalizeRawV2Path(path);
  if (!normalizedPath) {
    return;
  }

  const { indexStatus, workTreeStatus } = mapPorcelainV2XY(xy);
  lines.push({ indexStatus, workTreeStatus, path: normalizedPath });
}

/**
 * Parse `git status --porcelain=v2 -z` stdout into working-tree rows.
 *
 * Record types:
 * - `1 XY … path` — ordinary changed entry
 * - `2 XY … score newpath` + NUL + `oldpath` — rename/copy (uses new path)
 * - `u XY … path` — unmerged/conflict entry
 * - `? path` — untracked
 * - `! path` — ignored (skipped; v1 default porcelain omits these)
 *
 * v2 uses `.` for unchanged index/worktree slots; mapped to space for v1 parity.
 */
export function parseStatusPorcelainV2Z(stdout: string): ParsedStatusLine[] {
  const lines: ParsedStatusLine[] = [];
  const segments = stdout.split("\0").filter((segment) => segment.length > 0);

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const recordType = segment[0];

    if (recordType === "?") {
      const path = segment.slice(2);
      if (path) {
        lines.push({
          indexStatus: "?",
          workTreeStatus: "?",
          path: normalizeRawV2Path(path),
        });
      }
      continue;
    }

    if (recordType === "!") {
      continue;
    }

    // Tracked entry records (`1`, `u`, `2`) have a fixed number of
    // space-separated header fields before the path. The path is the remainder
    // of the record and may itself contain spaces (porcelain v2 -z output is
    // NUL-delimited, so it does not quote plain spaces). Splitting on every
    // space and taking the last field would therefore truncate
    // `src/my file.txt` to `txt`. Instead we skip exactly the header fields and
    // treat everything after as the path.
    if (recordType === "1" || recordType === "u") {
      const headerFieldCount = recordType === "1" ? 8 : 10;
      const parsed = parsePorcelainV2TrackedRecord(segment, headerFieldCount);
      if (parsed) {
        pushParsedStatusLine(lines, parsed.xy, parsed.path);
      }
      continue;
    }

    if (recordType === "2") {
      const parsed = parsePorcelainV2TrackedRecord(segment, 9);
      if (parsed) {
        pushParsedStatusLine(lines, parsed.xy, parsed.path);
      }
      // The renamed entry is followed by a NUL-delimited old-path segment.
      index += 1;
    }
  }

  return lines;
}

/**
 * Split a porcelain v2 tracked record (`1`/`u`/`2`) into its `XY` status and
 * the path, which begins after `headerFieldCount` space-separated header
 * fields. Returns `null` for malformed/truncated input.
 */
function parsePorcelainV2TrackedRecord(
  segment: string,
  headerFieldCount: number,
): { xy: string; path: string } | null {
  let spacesSeen = 0;
  let pathStart = -1;
  for (let i = 0; i < segment.length; i += 1) {
    if (segment[i] === " ") {
      spacesSeen += 1;
      if (spacesSeen === headerFieldCount) {
        pathStart = i + 1;
        break;
      }
    }
  }
  if (pathStart <= 0 || pathStart >= segment.length) {
    return null;
  }
  // XY is always the second field (after the record-type char).
  const xy = segment.slice(2, 4);
  const path = segment.slice(pathStart);
  return { xy, path };
}

/** Split parsed porcelain rows into staged and unstaged file lists. */
export function splitWorkingTreeStatus(lines: ParsedStatusLine[]): WorkingTreeStatus {
  const staged: WorkingTreeFileEntry[] = [];
  const unstaged: WorkingTreeFileEntry[] = [];

  for (const line of lines) {
    const { indexStatus, workTreeStatus, path } = line;
    const statusCode = `${indexStatus}${workTreeStatus}`;

    // Conflicted entries are unmerged — git does not let you stage one until
    // it is resolved, so they appear only in the unstaged list. Previously a
    // code like `DD` (indexStatus `D`, workTreeStatus `D`) was pushed into
    // both lists, letting a user "unstage" a conflicted path with no warning
    // and leaving a duplicate row that disagreed with itself (M9).
    if (isConflictStatusCode(statusCode)) {
      unstaged.push({
        path,
        indexStatus,
        workTreeStatus,
        statusCode,
      });
      continue;
    }

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
