import { collectOpenableFolderFiles } from "./folderOpenableFiles";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { findAllMatches } from "../editor/searchHighlight";

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
}

/** All matches within one file. */
export interface ProjectSearchResult {
  /** Absolute path of the file. */
  path: string;
  matches: ProjectSearchMatch[];
}

export interface SearchInProjectOptions {
  caseSensitive: boolean;
  /** Invoked once per file as it is scanned; return false to abort early. */
  onProgress?: (path: string) => boolean;
}

/**
 * Compute line/column/preview for each match in a document string. Pure — no
 * filesystem access — so it can be unit-tested and reused for preview/replace.
 */
export function computeFileMatches(
  content: string,
  query: string,
  caseSensitive: boolean,
): ProjectSearchMatch[] {
  if (!query) {
    return [];
  }
  const offsets = findAllMatches(content, query, caseSensitive);
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
 * Walk the whole workspace tree (reusing `collectOpenableFolderFiles`, which
 * skips heavy/hidden directories such as node_modules/.git) and return only the
 * files that contain at least one match. Each file is read and scanned
 * independently so a single unreadable file never aborts the whole search.
 */
export async function searchInProject(
  workspaceRoot: string,
  query: string,
  options: SearchInProjectOptions = { caseSensitive: false },
): Promise<ProjectSearchResult[]> {
  if (!query) {
    return [];
  }
  const files = await collectOpenableFolderFiles(workspaceRoot);
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
    const matches = computeFileMatches(content, query, options.caseSensitive);
    if (matches.length > 0) {
      results.push({ path, matches });
    }
  }
  return results;
}
