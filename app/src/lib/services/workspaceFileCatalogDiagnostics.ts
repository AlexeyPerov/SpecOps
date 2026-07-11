/**
 * Debug/performance diagnostics for the workspace file catalog and file
 * ranking. Every emitted diagnostic is content-free: it reports entry counts,
 * partial-error counts, status, generation, ranking durations, and incremental
 * invalidation tallies — never file paths beyond the workspace root or file
 * contents.
 */

import { elapsedMs, logPerfTiming, nowMs } from "./perfDiagnostics";
import type {
  WorkspaceFileCatalog,
  WorkspaceFileCatalogDiagnostics,
} from "./workspaceFileCatalog";
import type { RankedFilesResult } from "../picker/fileRanking";

export interface CatalogBuildDiagnosticsInput {
  workspaceRoot: string | null;
  entryCount: number;
  partialErrorCount: number;
  durationMs: number;
  status: WorkspaceFileCatalogDiagnostics["status"];
}

/**
 * Emit a content-free diagnostic for an initial catalog build. Call after the
 * first enumeration of a workspace settles.
 */
export function logCatalogBuild(input: CatalogBuildDiagnosticsInput): Promise<void> {
  return logPerfTiming("workspace file catalog build complete", {
    metric: "workspaceCatalog.build",
    durationMs: input.durationMs,
    workspaceRoot: input.workspaceRoot,
    entryCount: input.entryCount,
    partialErrorCount: input.partialErrorCount,
    status: input.status,
  });
}

/**
 * Emit a content-free diagnostic for a debounced catalog rebuild (watcher
 * invalidation).
 */
export function logCatalogRebuild(input: CatalogBuildDiagnosticsInput): Promise<void> {
  return logPerfTiming("workspace file catalog rebuild complete", {
    metric: "workspaceCatalog.rebuild",
    durationMs: input.durationMs,
    workspaceRoot: input.workspaceRoot,
    entryCount: input.entryCount,
    partialErrorCount: input.partialErrorCount,
    status: input.status,
  });
}

/**
 * Time a ranking pass and emit a content-free diagnostic. Returns the ranking
 * result unchanged so callers can wrap transparently.
 */
export function timedRankFiles<T extends RankedFilesResult>(
  query: string,
  rank: () => T,
): T {
  const startedAt = nowMs();
  const result = rank();
  void logPerfTiming("workspace file ranking complete", {
    metric: "workspaceCatalog.rank",
    durationMs: elapsedMs(startedAt),
    queryLength: query.trim().length,
    scannedCount: result.scannedCount,
    totalMatches: result.totalMatches,
    displayedCount: result.matches.length,
    status: result.status,
    truncated: result.truncated,
  });
  return result;
}

/**
 * Build a content-free snapshot of catalog state for an external observer
 * (e.g. a future debug overlay). Excludes all file contents and individual
 * paths except the workspace root.
 */
export function catalogDiagnosticsSummary(
  catalog: WorkspaceFileCatalog,
): WorkspaceFileCatalogDiagnostics {
  return catalog.getDiagnostics();
}
