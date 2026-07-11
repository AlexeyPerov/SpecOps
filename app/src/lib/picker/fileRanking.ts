/**
 * File-candidate ranking adapter over shared fuzzy scoring.
 *
 * Translates {@link WorkspaceFileCatalogSnapshot} entries into fuzzy-rankable
 * candidates (basename as primary text, relative path + directory as alt
 * texts), applies stable recency boosts from already-open / recent-file state
 * without changing persisted formats, deduplicates by normalized key, and
 * bounds the displayed result set while retaining total-match / loading
 * metadata for the picker chrome.
 *
 * Pure and side-effect free: no state mutation, no I/O.
 */

import { fuzzyRank, type FuzzyCandidate, type FuzzyMatch } from "./fuzzyRank";
import { normalizePathSync } from "../services/diskFingerprint";
import type { WorkspaceFileEntry } from "../services/workspaceFileCatalog";

/**
 * Inputs that determine recency boosts. Both arrays are absolute paths; order
 * is most-recent-first. Open files always outrank recent files, which outrank
 * catalog-only entries. These are derived from existing app state — no
 * persisted formats are changed.
 */
export interface FileRecencyInputs {
  /** Absolute paths of files currently open in the active context (any order). */
  openPaths?: readonly string[];
  /** Absolute paths of recently opened files, most-recent-first. */
  recentPaths?: readonly string[];
}

export interface RankFilesOptions extends FileRecencyInputs {
  /** Maximum number of ranked results to return. Default 200. */
  limit?: number;
}

/** A ranked file candidate ready for picker rendering. */
export interface RankedFile {
  entry: WorkspaceFileEntry;
  score: number;
  /** Match ranges against {@link WorkspaceFileEntry.basename} for highlighting. */
  ranges: readonly { start: number; end: number }[];
  /** Why this entry is boosted: "open", "recent", or null (catalog only). */
  recency: "open" | "recent" | null;
}

/** Metadata about the ranking pass, returned alongside the bounded result list. */
export interface RankedFilesResult {
  /** Bounded ranked matches, best first. */
  matches: RankedFile[];
  /** Total number of entries that matched the query (before bounding). */
  totalMatches: number;
  /** Total number of entries scanned (catalog size at call time). */
  scannedCount: number;
  /** Catalog status at call time — pickers show "loading" hints when not "ready". */
  status: "idle" | "loading" | "ready" | "error";
  /** Whether the result list was truncated by the limit. */
  truncated: boolean;
}

const DEFAULT_LIMIT = 200;

/**
 * Recency score for a normalized path. Open files get the highest band, then
 * recent files by reverse index (most recent wins), then 0 for catalog-only.
 * Multiplied by the shared ranking tie-break weight internally.
 */
function recencyScoreFor(
  normalizedPath: string,
  openKeys: ReadonlySet<string>,
  recentKeys: readonly string[],
): { score: number; recency: "open" | "recent" | null } {
  if (openKeys.has(normalizedPath)) {
    return { score: 1000, recency: "open" };
  }
  const recentIndex = recentKeys.indexOf(normalizedPath);
  if (recentIndex >= 0) {
    // Most recent (index 0) gets the highest recent boost; decay by index.
    return { score: 500 - recentIndex, recency: "recent" };
  }
  return { score: 0, recency: null };
}

/**
 * Deduplicate catalog entries by normalized key while preserving first-seen
 * order. Guards against duplicate enumeration from incremental add paths and
 * against case-sensitivity differences on case-insensitive filesystems (the
 * normalizer already lowercases on macOS, so keys are already canonical).
 */
function dedupeEntries(entries: readonly WorkspaceFileEntry[]): WorkspaceFileEntry[] {
  const seen = new Set<string>();
  const out: WorkspaceFileEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      continue;
    }
    seen.add(entry.key);
    out.push(entry);
  }
  return out;
}

/**
 * Rank workspace file entries for quick open.
 *
 * Empty query orders open files first, then recent files (most-recent-first),
 * then the remaining catalog paths in their stable (locale-sorted) order.
 */
export function rankFiles(
  snapshot: {
    entries: readonly WorkspaceFileEntry[];
    status: "idle" | "loading" | "ready" | "error";
  },
  query: string,
  options: RankFilesOptions = {},
): RankedFilesResult {
  const limit = Math.max(0, options.limit ?? DEFAULT_LIMIT);
  const deduped = dedupeEntries(snapshot.entries);
  const scannedCount = deduped.length;

  // Pre-compute normalized recency lookup sets.
  const openKeys = new Set((options.openPaths ?? []).map(normalizePathSync));
  const recentKeys = (options.recentPaths ?? []).map(normalizePathSync);

  const needle = query.trim();

  // Empty query: preserve caller order but reorder by recency bands.
  if (needle.length === 0) {
    const open: RankedFile[] = [];
    const recent: RankedFile[] = [];
    const rest: RankedFile[] = [];
    for (const entry of deduped) {
      const { recency } = recencyScoreFor(entry.key, openKeys, recentKeys);
      const ranked: RankedFile = { entry, score: 0, ranges: [], recency };
      if (recency === "open") {
        open.push(ranked);
      } else if (recency === "recent") {
        recent.push(ranked);
      } else {
        rest.push(ranked);
      }
    }
    // Recent files keep their most-recent-first order (already caller-sorted).
    const matches = [...open, ...recent, ...rest];
    const totalMatches = matches.length;
    return {
      matches: limit > 0 ? matches.slice(0, limit) : matches,
      totalMatches,
      scannedCount,
      status: snapshot.status,
      truncated: limit > 0 && totalMatches > limit,
    };
  }

  const candidates: FuzzyCandidate<WorkspaceFileEntry>[] = deduped.map((entry) => {
    const { score } = recencyScoreFor(entry.key, openKeys, recentKeys);
    return {
      item: entry,
      text: entry.basename,
      altTexts: [entry.relativePath, entry.directory],
      recentScore: score,
    };
  });

  // Rank unbounded so we know the true total match count, then slice for the
  // displayed set. Slicing a pre-sorted array is cheap; the expensive part is
  // the scoring pass, which has to see every candidate anyway.
  const ranked: FuzzyMatch<WorkspaceFileEntry>[] = fuzzyRank(candidates, query);
  const totalMatches = ranked.length;

  const bounded = limit > 0 ? ranked.slice(0, limit) : ranked;

  // Re-derive the recency band per surviving match (cheap set lookups).
  const matches: RankedFile[] = bounded.map((match) => {
    const { recency } = recencyScoreFor(match.item.key, openKeys, recentKeys);
    return {
      entry: match.item,
      score: match.score,
      ranges: match.ranges,
      recency,
    };
  });

  return {
    matches,
    totalMatches,
    scannedCount,
    status: snapshot.status,
    truncated: limit > 0 && totalMatches > limit,
  };
}

/**
 * Build a recency-ordered empty-query list without running fuzzy scoring.
 * Useful for pickers that want a stable "recent + catalog" view before the
 * user types. Equivalent to {@link rankFiles} with an empty query.
 */
export function recentFileOrder(
  entries: readonly WorkspaceFileEntry[],
  recency: FileRecencyInputs,
): WorkspaceFileEntry[] {
  return rankFiles({ entries, status: "ready" }, "", recency).matches.map((m) => m.entry);
}
