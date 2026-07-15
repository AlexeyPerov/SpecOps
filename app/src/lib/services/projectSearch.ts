import { collectOpenableFolderFiles } from "./folderOpenableFiles";
import { readTextFile } from "@tauri-apps/plugin-fs";
import {
  findAllRangesInString,
  validateSearchQuery,
  type SearchQuery,
} from "../editor/searchQuery";

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
  | { ok: true; results: ProjectSearchResult[] }
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
  for (const path of files) {
    if (options.onProgress?.(path) === false) {
      break;
    }
    let content: string;
    try {
      content = await readTextFile(path);
    } catch {
      continue;
    }
    const matches = computeFileMatches(content, query);
    if (matches.length > 0) {
      results.push({ path, matches });
    }
  }
  return { ok: true, results };
}
