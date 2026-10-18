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

    // A mode change is two extended-header lines: `old mode <m>` then
    // `new mode <m>`.
    if (currentHunk === null && line.startsWith("old mode ")) {
      oldMode = line.slice("old mode ".length).trim();
      continue;
    }

    if (currentHunk === null && line.startsWith("new mode ")) {
      newMode = line.slice("new mode ".length).trim();
      continue;
    }

    // `rename from/to` and `copy from/to` carry the exact (possibly quoted)
    // paths without an `a/`/`b/` prefix. They are the only reliable source for
    // a pure rename whose bare paths contain spaces: such a diff has no
    // `---`/`+++` headers and its `diff --git` line is ambiguous.
    const renameOrCopy = currentHunk === null
      ? /^(rename|copy) (from|to) (.+)$/.exec(line)
      : null;
    if (renameOrCopy) {
      const headerPath = normalizeGitOutputPath(unquoteGitPath(renameOrCopy[3]!));
      if (renameOrCopy[2] === "from") {
        oldPath = headerPath;
      } else {
        path = headerPath;
      }
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
/// (`"a/path"`, when the path contains characters git C-quotes) or bare. A bare
/// path may contain spaces, which makes the line ambiguous in general; the
/// resolution order mirrors git's own header parsing:
///
/// 1. Exactly two quote-aware tokens: use them.
/// 2. One side quoted, the other bare: split at the quoted token's edge.
/// 3. Both bare: when old and new name the same file the line is
///    `a/<P> b/<P>`, so split it into two equal halves around the middle space.
/// 4. Otherwise (a rename whose bare paths contain spaces) split at the first
///    ` b/`; the caller then overrides both paths from the reliable
///    `rename from/to` / `copy from/to` / `---`/`+++` header lines.
function parseDiffGitPathPair(rest: string): { oldRaw: string; newRaw: string } | null {
  const tokens = tokenizeDiffGitPaths(rest);
  if (tokens.length === 2) {
    return { oldRaw: tokens[0]!, newRaw: tokens[1]! };
  }
  if (tokens.length < 2) {
    return null;
  }

  if (rest.startsWith('"')) {
    const oldRaw = tokens[0]!;
    const newRaw = rest.slice(oldRaw.length).replace(/^ /, "");
    return newRaw ? { oldRaw, newRaw } : null;
  }

  if (rest.endsWith('"')) {
    // An unescaped ` "` cannot occur inside a quoted path (an embedded quote is
    // written as `\"`), so the last ` "` starts the quoted new path.
    const quoteStart = rest.lastIndexOf(' "');
    if (quoteStart > 0) {
      return { oldRaw: rest.slice(0, quoteStart), newRaw: rest.slice(quoteStart + 1) };
    }
  }

  if (rest.length % 2 === 1) {
    const middle = (rest.length - 1) / 2;
    const oldRaw = rest.slice(0, middle);
    const newRaw = rest.slice(middle + 1);
    if (
      rest[middle] === " " &&
      oldRaw.startsWith("a/") &&
      newRaw.startsWith("b/") &&
      oldRaw.slice(2) === newRaw.slice(2)
    ) {
      return { oldRaw, newRaw };
    }
  }

  const boundary = rest.indexOf(" b/", 1);
  if (boundary === -1) {
    return null;
  }
  const oldRaw = rest.slice(0, boundary);
  const newRaw = rest.slice(boundary + 1);
  return oldRaw && newRaw ? { oldRaw, newRaw } : null;
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
