import {
  normalizeGitOutputPath,
  type DiffHunk,
  type DiffLine,
  type ParsedTextDiff,
} from "./types";
import { decodeGitQuotedPath } from "./gitParse";

const DIFF_GIT_PREFIX = "diff --git ";
const HUNK_HEADER =
  /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(?:\s+(.*))?$/;
const INDEX_LINE =
  /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?:\s+(\S+))?$/i;

interface DiffGitPaths {
  oldPath: string;
  newPath: string;
}

interface HunkStart {
  oldStart: number;
  newStart: number;
}

/** Parse unified `git diff` / `git show --patch` stdout into per-file text diffs. */
export function parseUnifiedDiff(stdout: string): ParsedTextDiff[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  return splitDiffSections(stdout).map(parseDiffSection);
}

function normalizeDiffLine(line: string): string {
  return line.replace(/\r$/, "");
}

function splitDiffSections(stdout: string): string[] {
  const lines = stdout.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const rawLine of lines) {
    const line = normalizeDiffLine(rawLine);
    if (line.startsWith(DIFF_GIT_PREFIX) && current.length > 0) {
      sections.push(trimSection(current));
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    sections.push(trimSection(current));
  }

  return sections.filter((section) => section.length > 0);
}

function trimSection(lines: string[]): string {
  const copy = [...lines];
  while (copy.length > 0 && copy[copy.length - 1] === "") {
    copy.pop();
  }
  return copy.join("\n");
}

function parseDiffSection(section: string): ParsedTextDiff {
  const lines = section.split("\n");
  const gitPaths = parseDiffGitLine(lines[0] ?? "");
  let path = gitPaths?.newPath ?? "";
  let oldPath = gitPaths?.oldPath;
  let oldMode: string | undefined;
  let newMode: string | undefined;
  let isBinary = false;
  let addedLines = 0;
  let deletedLines = 0;
  const hunks: DiffHunk[] = [];

  let currentHunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (let index = 1; index < lines.length; index += 1) {
    const line = normalizeDiffLine(lines[index] ?? "");

    if (line.startsWith("new file mode ")) {
      newMode = line.slice("new file mode ".length).trim();
      continue;
    }

    if (line.startsWith("deleted file mode ")) {
      oldMode = line.slice("deleted file mode ".length).trim();
      continue;
    }

    const modeChange = /^old mode (\S+) new mode (\S+)$/.exec(line);
    if (modeChange) {
      oldMode = modeChange[1];
      newMode = modeChange[2];
      continue;
    }

    const indexMatch = INDEX_LINE.exec(line);
    if (indexMatch) {
      const modePart = indexMatch[3];
      if (modePart) {
        if (modePart.includes("..")) {
          const [old, next] = modePart.split("..");
          oldMode = old;
          newMode = next;
        } else {
          oldMode = oldMode ?? modePart;
          newMode = newMode ?? modePart;
        }
      }
      continue;
    }

    if (line.startsWith("Binary files ") && line.endsWith(" differ")) {
      isBinary = true;
      continue;
    }

    // `--- `/`+++ ` are the per-file old/new path headers and only appear
    // before the first hunk. Once a hunk has started they are body content
    // (e.g. a deleted SQL/Lua/Haskell `--` comment rendered as `--- get user`,
    // or added text starting with `+++`). Without the `currentHunk === null`
    // guard such a body line was parsed as a header: it never reached the
    // `+`/`-` branch, so `deletedLines` was undercounted and `oldPath` was
    // rewritten from the comment text, which in turn made the file look
    // renamed (M8).
    if (currentHunk === null && line.startsWith("--- ")) {
      const headerPath = parsePathHeader(line.slice(4));
      if (headerPath && headerPath !== "/dev/null") {
        oldPath = headerPath;
      }
      continue;
    }

    if (currentHunk === null && line.startsWith("+++ ")) {
      const headerPath = parsePathHeader(line.slice(4));
      if (headerPath && headerPath !== "/dev/null") {
        path = headerPath;
      }
      continue;
    }

    if (line.startsWith("@@")) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }

      const header = parseHunkHeader(line);
      if (header) {
        oldLineNo = header.oldStart;
        newLineNo = header.newStart;
      }

      currentHunk = {
        header: line,
        lines: [{ kind: "hunk-header", content: line }],
      };
      continue;
    }

    if (!currentHunk || isBinary) {
      continue;
    }

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        kind: "added",
        content: line.slice(1),
        newLineNo,
      });
      addedLines += 1;
      newLineNo += 1;
      continue;
    }

    if (line.startsWith("-")) {
      currentHunk.lines.push({
        kind: "deleted",
        content: line.slice(1),
        oldLineNo,
      });
      deletedLines += 1;
      oldLineNo += 1;
      continue;
    }

    if (line.startsWith("\\")) {
      currentHunk.lines.push({
        kind: "meta",
        content: line,
      });
      continue;
    }

    const content = line.startsWith(" ") ? line.slice(1) : line;
    currentHunk.lines.push({
      kind: "context",
      content,
      oldLineNo,
      newLineNo,
    });
    oldLineNo += 1;
    newLineNo += 1;
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return {
    path,
    oldPath: oldPath && oldPath !== path ? oldPath : undefined,
    hunks: isBinary ? [] : hunks,
    addedLines,
    deletedLines,
    isBinary,
    oldMode,
    newMode,
  };
}

function parseDiffGitLine(line: string): DiffGitPaths | null {
  if (!line.startsWith(DIFF_GIT_PREFIX)) {
    return null;
  }

  const paths = parseDiffGitPathPair(line.slice(DIFF_GIT_PREFIX.length));
  if (!paths) {
    return null;
  }

  return {
    oldPath: stripGitPathPrefix(paths.oldRaw),
    newPath: stripGitPathPrefix(paths.newRaw),
  };
}

/// Parse the two path halves of a `diff --git a/<old> b/<new>` header.
///
/// git emits exactly two paths after `diff --git`. Each is either quoted
/// (`"a/path"`, used when the path contains characters git's `quote_c.c` flags)
/// or bare. The previous tokenizer split on whitespace, which broke on a bare
/// path containing a space — verified `diff --git a/my img.png b/my img.png`
/// yielded four tokens and `parseDiffGitLine` returned null, so a binary or
/// mode-only diff (no `---`/`+++` lines to recover the path from) rendered as
/// "Could not load diff" instead of the existing binary placeholder.
///
/// F22: when the bare-token count is not exactly two, fall back to the known
/// ` b/` boundary git places between the two halves. The first token is always
/// a complete bare/quoted unit, so the boundary we want is the first ` b/`
/// (or `"b/`) *after* it; the second half is the canonical path used for the
/// file lookup.
function parseDiffGitPathPair(rest: string): { oldRaw: string; newRaw: string } | null {
  const tokens = tokenizeDiffGitPaths(rest);
  if (tokens.length === 2) {
    return { oldRaw: tokens[0]!, newRaw: tokens[1]! };
  }
  if (tokens.length < 2) {
    return null;
  }

  // Ambiguous: a bare path contains whitespace. Locate the second half by
  // scanning for ` b/` (or ` "b/`) starting just past the first token, then
  // re-split there. The first token is always a complete bare/quoted unit, so
  // the boundary we want is the first ` b/` *after* it.
  const firstEnd = tokenEndOffset(rest, 0);
  if (firstEnd < 0) {
    return null;
  }
  const tail = rest.slice(firstEnd);
  const boundaryIdx = findPathBoundary(tail);
  if (boundaryIdx < 0) {
    return null;
  }
  const oldRaw = rest.slice(0, firstEnd).trim();
  const newRaw = tail.slice(boundaryIdx).trim();
  if (!oldRaw || !newRaw) {
    return null;
  }
  return { oldRaw, newRaw };
}

/// Index in `rest` just past the end of token `tokenIndex` (inclusive of any
/// trailing inter-token whitespace), or -1 if there is no such token. Used to
/// anchor the second-half boundary search after the first complete token.
function tokenEndOffset(rest: string, tokenIndex: number): number {
  let index = 0;
  let consumed = 0;
  while (index < rest.length && consumed <= tokenIndex) {
    while (index < rest.length && rest[index] === " ") {
      index += 1;
    }
    if (index >= rest.length) {
      break;
    }
    if (rest[index] === '"') {
      let end = index + 1;
      while (end < rest.length) {
        if (rest[end] === "\\" && end + 1 < rest.length) {
          end += 2;
          continue;
        }
        if (rest[end] === '"') {
          break;
        }
        end += 1;
      }
      index = end + 1;
    } else {
      const nextSpace = rest.indexOf(" ", index);
      index = nextSpace === -1 ? rest.length : nextSpace;
    }
    consumed += 1;
  }
  return consumed > tokenIndex ? index : -1;
}

/// Offset into `tail` of the start of the second path half. git always emits
/// the new path with a `b/` prefix (or `"b/` when quoted), preceded by a single
/// space. The first such occurrence after the first token is the boundary.
function findPathBoundary(tail: string): number {
  for (let index = 0; index < tail.length; index += 1) {
    if (tail[index] !== " ") {
      continue;
    }
    const look = tail.slice(index + 1);
    if (look.startsWith("b/") || look.startsWith('"b/')) {
      return index + 1;
    }
  }
  return -1;
}

function tokenizeDiffGitPaths(raw: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < raw.length) {
    while (index < raw.length && raw[index] === " ") {
      index += 1;
    }
    if (index >= raw.length) {
      break;
    }

    if (raw[index] === '"') {
      let end = index + 1;
      while (end < raw.length) {
        if (raw[end] === "\\" && end + 1 < raw.length) {
          end += 2;
          continue;
        }
        if (raw[end] === '"') {
          break;
        }
        end += 1;
      }
      tokens.push(raw.slice(index, end + 1));
      index = end + 1;
      continue;
    }

    const nextSpace = raw.indexOf(" ", index);
    if (nextSpace === -1) {
      tokens.push(raw.slice(index));
      break;
    }
    tokens.push(raw.slice(index, nextSpace));
    index = nextSpace + 1;
  }

  return tokens;
}

function stripGitPathPrefix(raw: string): string {
  const unquoted = unquoteGitPath(raw);
  if (unquoted.startsWith("a/") || unquoted.startsWith("b/")) {
    return normalizeGitOutputPath(unquoted.slice(2));
  }
  return normalizeGitOutputPath(unquoted);
}

function unquoteGitPath(raw: string): string {
  // F23: do not `.trim()` the unquoted form. git appends a TAB to disambiguate
  // an unquoted path with a trailing space (`+++ b/trail.txt \t`); the tab is
  // stripped in `parsePathHeader`, but the trailing space is part of the
  // filename and must survive. Trimming here made the parsed path mismatch the
  // status path, so the diff lookup failed.
  if (raw.startsWith('"') && raw.endsWith('"')) {
    // F20: hand off to the same octal-aware decoder the porcelain `-z` path uses.
    // git's `core.quotepath=true` (the default) emits non-ASCII bytes as `\NNN`
    // octal escapes inside the double quotes — `caf\303\251.txt` for `café.txt`.
    // The previous implementation only handled `[\\"nrt]`, so every Cyrillic,
    // accented, CJK or emoji filename parsed to a string that no longer matched
    // the status path and the diff lookup threw `GitCommitFileDiffNotFoundError`.
    return decodeGitQuotedPath(raw.slice(1, -1));
  }
  return raw;
}

function parsePathHeader(raw: string): string | null {
  // F23: git appends a TAB to an unquoted diff-header path that contains a
  // trailing space (`--- a/trail.txt \t`) to disambiguate it. A full `.trim()`
  // eats that tab *and* the significant trailing space, so the parsed path no
  // longer matches the status path. Strip at most one trailing tab; the leading
  // whitespace of a header is never significant.
  const leadingTrimmed = raw.replace(/^\s+/, "").replace(/\t$/, "");
  if (!leadingTrimmed) {
    return null;
  }
  if (leadingTrimmed === "/dev/null") {
    return "/dev/null";
  }
  return stripGitPathPrefix(leadingTrimmed);
}

function parseHunkHeader(line: string): HunkStart | null {
  const match = HUNK_HEADER.exec(line);
  if (!match) {
    return null;
  }

  return {
    oldStart: Number.parseInt(match[1]!, 10),
    newStart: Number.parseInt(match[2]!, 10),
  };
}
