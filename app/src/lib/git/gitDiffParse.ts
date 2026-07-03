import { normalizeGitOutputPath, type DiffHunk, type DiffLine, type ParsedTextDiff } from "./types";

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

function splitDiffSections(stdout: string): string[] {
  const lines = stdout.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
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
    const line = lines[index] ?? "";

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

    if (line.startsWith("--- ")) {
      const headerPath = parsePathHeader(line.slice(4));
      if (headerPath && headerPath !== "/dev/null") {
        oldPath = headerPath;
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
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

  const tokens = tokenizeDiffGitPaths(line.slice(DIFF_GIT_PREFIX.length));
  if (tokens.length !== 2) {
    return null;
  }

  return {
    oldPath: stripGitPathPrefix(tokens[0]!),
    newPath: stripGitPathPrefix(tokens[1]!),
  };
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
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\([\\"nrt])/g, (_match, char: string) => {
        switch (char) {
          case "n":
            return "\n";
          case "t":
            return "\t";
          case "r":
            return "\r";
          case '"':
            return '"';
          case "\\":
            return "\\";
          default:
            return char;
        }
      });
  }
  return trimmed;
}

function parsePathHeader(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === "/dev/null") {
    return "/dev/null";
  }
  return stripGitPathPrefix(trimmed);
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
