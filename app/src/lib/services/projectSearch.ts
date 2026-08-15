import { Text } from "@codemirror/state";
import { collectOpenableFolderFiles } from "./folderOpenableFiles";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
import { isImageFilePath } from "./fileContentKind";
import { mapWithConcurrency } from "./mapWithConcurrency";
import {
  findAllRangesInText,
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

/**
 * P03-08-30: in-flight file concurrency for the project scan. Previously the
 * loop awaited `stat` + `readTextFile` per file sequentially — 10k sequential
 * IPC round-trips for a 5k-file workspace. A bounded fan-out (12) overlaps the
 * IPC waits without flooding the bridge or exceeding the per-file size cap.
 */
const PROJECT_SEARCH_CONCURRENCY = 12;

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
      /** Number of files whose contents were actually read and scanned. */
      scannedFiles: number;
      /** Files skipped because `stat` or `readTextFile` failed (permissions, gone, binary…). */
      unreadableFiles: number;
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
  // One split → Text tree; RegExpCursor + lineAt reuse that structure (no second
  // full-document char scan for line starts/ends).
  const text = Text.of(content.split("\n"));
  const offsets = findAllRangesInText(text, query);
  if (offsets.length === 0) {
    return [];
  }

  const matches: ProjectSearchMatch[] = [];
  for (const offset of offsets) {
    const line = text.lineAt(offset.from);
    matches.push({
      line: line.number,
      column: offset.from - line.from + 1,
      lineText: line.text,
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

  // Shared mutable scan state. JS is single-threaded, so the counters are
  // updated atomically between awaits — no locking needed. `aborted` lets a
  // worker that observed the onProgress bail or the match cap signal the other
  // workers to short-circuit without each re-checking the whole file set.
  const results: ProjectSearchResult[] = [];
  let totalMatches = 0;
  let truncated = false;
  let aborted = false;
  let scannedFiles = 0;
  let unreadableFiles = 0;

  await mapWithConcurrency(files, PROJECT_SEARCH_CONCURRENCY, async (path) => {
    if (aborted) {
      return;
    }
    if (options.onProgress?.(path) === false) {
      aborted = true;
      return;
    }
    // Images are "openable" (they render in a preview pane) but are not text;
    // decoding them as UTF-8 just produces garbage matches.
    if (isImageFilePath(path)) {
      return;
    }
    try {
      const info = await stat(path);
      if (Number(info.size) > MAX_SEARCH_FILE_BYTES) {
        return;
      }
    } catch {
      unreadableFiles += 1;
      return;
    }
    if (aborted) {
      return;
    }
    let content: string;
    try {
      content = await readTextFile(path);
    } catch {
      unreadableFiles += 1;
      return;
    }
    if (aborted) {
      return;
    }
    scannedFiles += 1;
    const matches = computeFileMatches(content, query);
    if (matches.length === 0) {
      return;
    }
    const remaining = MAX_SEARCH_TOTAL_MATCHES - totalMatches;
    if (remaining <= 0) {
      truncated = true;
      aborted = true;
      return;
    }
    if (matches.length >= remaining) {
      // Synchronous claim of the remaining budget before another worker can
      // read `totalMatches` — this is the only section where ordering matters,
      // and it contains no await.
      results.push({ path, matches: matches.slice(0, remaining) });
      totalMatches += remaining;
      truncated = true;
      aborted = true;
      return;
    }
    results.push({ path, matches });
    totalMatches += matches.length;
  });
  return { ok: true, results, truncated, scannedFiles, unreadableFiles };
}
