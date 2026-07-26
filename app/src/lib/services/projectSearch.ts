import { collectOpenableFolderFiles } from "./folderOpenableFiles";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
import { isImageFilePath } from "./fileContentKind";
import {
  findAllRangesInString,
  validateSearchQuery,
  type SearchQuery,
} from "../editor/searchQuery";

/**
 * Per-file size cap (H28). The openable-file catalog admits any file without a
 * dot in its basename, so one multi-hundred-MB extensionless file would
 * otherwise be pulled fully through IPC and can OOM the webview. Checked via
 * `stat` before reading.
 */
export const MAX_SEARCH_FILE_BYTES = 4 * 1024 * 1024;

/**
 * Total match cap (H28). Results are rendered unvirtualized; an
 * over-productive query (e.g. searching for `e`) should stop early instead of
 * building an unbounded result set.
 */
export const MAX_SEARCH_TOTAL_MATCHES = 10_000;

/** A single match inside a file. */
export interface ProjectSearchMatch {
  /** 1-based line number. */
  line: number;
  /** 1-based column (character offset within the line). */
  column: number;
  /** The full text of the line containing the match (trimmed of trailing newline). */
  lineText: string;
  /** Character offset (0-based) of the match start within the whole document. */
  from: number;
  /** Character offset (0-based) of the match end within the whole document. */
  to: number;
  /** Length of the matched text (`to - from`). */
  length: number;
}

/** All matches within one file. */
export interface ProjectSearchResult {
  /** Absolute path of the file. */
  path: string;
  matches: ProjectSearchMatch[];
}

export interface SearchInProjectOptions {
  /** Invoked once per file as it is scanned; return false to abort early. */
  onProgress?: (path: string) => boolean;
  /**
   * Precomputed openable-file list (e.g. workspace catalog snapshot).
   * When provided, skips a duplicate workspace walk.
   */
  files?: readonly string[];
}

/**
 * Result of a project search: either the matched results, or a structured
 * error when the query itself is invalid (e.g. bad regex).
 */
export type ProjectSearchOutcome =
  | {
      ok: true;
      results: ProjectSearchResult[];
      /** True when the search stopped early at {@link MAX_SEARCH_TOTAL_MATCHES}. */
      truncated?: boolean;
    }
  | { ok: false; reason: string };

/**
 * Compute line/column/preview for each match in a document string. Pure — no
 * filesystem access — so it can be unit-tested and reused for preview/replace.
 * Uses the unified query model so project and editor search agree on semantics.
 */
export function computeFileMatches(
  content: string,
  query: SearchQuery,
): ProjectSearchMatch[] {
  if (!query.text) {
    return [];
  }
  const offsets = findAllRangesInString(content, query);
  if (offsets.length === 0) {
    return [];
  }

  // Precompute the start offset of every line so we can map each match offset
  // to its (1-based) line/column without scanning from the top for each match.
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }
  const lineEnds: number[] = [];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === "\n") {
      lineEnds.push(i);
    }
  }
  lineEnds.push(content.length);

  const matches: ProjectSearchMatch[] = [];
  let lineHint = 0; // index into lineStarts; advances monotonically with matches
  for (const offset of offsets) {
    // Advance the hint until the match start falls inside this line.
    while (lineHint + 1 < lineStarts.length && lineStarts[lineHint + 1] <= offset.from) {
      lineHint += 1;
    }
    const lineIndex = lineHint;
    const column = offset.from - lineStarts[lineIndex] + 1;
    const lineText = content.slice(lineStarts[lineIndex], lineEnds[lineIndex]);
    matches.push({
      line: lineIndex + 1,
      column,
      lineText,
      from: offset.from,
      to: offset.to,
      length: offset.to - offset.from,
    });
  }
  return matches;
}

/** Total match count across all results. */
export function totalMatchCount(results: readonly ProjectSearchResult[]): number {
  let total = 0;
  for (const result of results) {
    total += result.matches.length;
  }
  return total;
}

/**
 * Search openable workspace files. Prefers a catalog snapshot via `options.files`
 * to avoid a duplicate tree walk; falls back to a one-shot enumeration.
 *
 * The query is validated before traversal; an invalid query returns
 * `{ ok: false, reason }` without touching any file. Per-file read errors are
 * isolated (the file is skipped).
 */
export async function searchInProject(
  workspaceRoot: string,
  query: SearchQuery,
  options: SearchInProjectOptions = {},
): Promise<ProjectSearchOutcome> {
  const validation = validateSearchQuery(query);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }
  const files =
    options.files !== undefined
      ? options.files
      : await collectOpenableFolderFiles(workspaceRoot);
  const results: ProjectSearchResult[] = [];
  let totalMatches = 0;
  let truncated = false;
  for (const path of files) {
    if (options.onProgress?.(path) === false) {
      break;
    }
    // Images are "openable" (they render in a preview pane) but are not text;
    // decoding them as UTF-8 just produces garbage matches.
    if (isImageFilePath(path)) {
      continue;
    }
    try {
      const info = await stat(path);
      if (Number(info.size) > MAX_SEARCH_FILE_BYTES) {
        continue;
      }
    } catch {
      continue;
    }
    let content: string;
    try {
      content = await readTextFile(path);
    } catch {
      continue;
    }
    const matches = computeFileMatches(content, query);
    if (matches.length === 0) {
      continue;
    }
    const remaining = MAX_SEARCH_TOTAL_MATCHES - totalMatches;
    if (matches.length >= remaining) {
      results.push({ path, matches: matches.slice(0, remaining) });
      truncated = true;
      break;
    }
    results.push({ path, matches });
    totalMatches += matches.length;
  }
  return { ok: true, results, truncated };
}
