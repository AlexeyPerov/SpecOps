import { formatGitErrorPrimaryMessage } from "./gitErrorUi";
import { shouldLoadWorkspaceManagerGitColumn } from "./gitIntegrationGating";
import { logDiagnostic } from "../services/logging";
import { checkGitAvailable, resolveRepoRoot } from "./gitService";
import {
  queryRepositoryStatusSummary,
  type RepositoryStatusSummary,
} from "./repositoryStatusSummary";
import {
  subscribeVersionControlMutations,
  type VersionControlMutationScope,
} from "./versionControlRefresh";

export type WorkspaceGitColumnCell =
  | { status: "loading" }
  | { status: "neutral"; text: "—" }
  | { status: "ready"; summary: RepositoryStatusSummary; displayText: string }
  | { status: "error"; text: "Git error"; message: string };

const NEUTRAL_CELL: WorkspaceGitColumnCell = { status: "neutral", text: "—" };

function errorGitColumnCell(message: string): WorkspaceGitColumnCell {
  return {
    status: "error",
    text: "Git error",
    message,
  };
}

const GIT_COLUMN_REFRESH_DEBOUNCE_MS = 300;

/**
 * P03-08-07 — per-workspace result TTL. A fresh cell is reused without
 * re-shelling-out to git, so re-mounting the Workspace Manager (or a quick
 * list change) no longer fans out 2N blocking git processes for data that was
 * just loaded. Mutations invalidate the entry via
 * `invalidateWorkspaceGitColumnCell`.
 */
const WORKSPACE_GIT_COLUMN_TTL_MS = 60_000;

interface CachedCell {
  at: number;
  cell: WorkspaceGitColumnCell;
}

const cellCacheByPath = new Map<string, CachedCell>();

/** Drop the cached cell for one workspace (mutations + explicit invalidation). */
export function invalidateWorkspaceGitColumnCell(workspaceRootPath: string): void {
  cellCacheByPath.delete(workspaceRootPath);
}

/** Clear all cached cells (tests only). */
export function resetWorkspaceGitColumnCacheForTests(): void {
  cellCacheByPath.clear();
}

const inFlightByPath = new Map<string, Promise<WorkspaceGitColumnCell>>();
const gitColumnRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Human-readable git column text: branch · ahead/behind · dirty/clean. */
export function formatGitColumnDisplayText(summary: RepositoryStatusSummary): string {
  const branchLabel = summary.isDetached ? `detached @ ${summary.branchName}` : summary.branchName;
  const parts: string[] = [branchLabel];

  if (summary.aheadBehind) {
    const trackingParts: string[] = [];
    if (summary.aheadBehind.ahead > 0) {
      trackingParts.push(`↑${summary.aheadBehind.ahead}`);
    }
    if (summary.aheadBehind.behind > 0) {
      trackingParts.push(`↓${summary.aheadBehind.behind}`);
    }
    if (trackingParts.length > 0) {
      parts.push(trackingParts.join(" "));
    }
  }

  parts.push(summary.isDirty ? "dirty" : "clean");
  return parts.join(" · ");
}

async function loadWorkspaceGitColumnCellInternal(
  workspaceRootPath: string,
): Promise<WorkspaceGitColumnCell> {
  try {
    const gitAvailability = await checkGitAvailable();
    if (!gitAvailability.available) {
      return NEUTRAL_CELL;
    }

    const repoResult = await resolveRepoRoot(workspaceRootPath);
    if (!repoResult.ok) {
      return NEUTRAL_CELL;
    }

    const summary = await queryRepositoryStatusSummary(repoResult.repoRoot);
    return {
      status: "ready",
      summary,
      displayText: formatGitColumnDisplayText(summary),
    };
  } catch (error) {
    const message = formatGitErrorPrimaryMessage(error);
    void logDiagnostic({
      level: "warn",
      source: "frontend",
      message: "Failed to load workspace git column cell",
      timestamp: new Date().toISOString(),
      metadata: {
        workspaceRootPath,
        operation: "loadWorkspaceGitColumnCell",
        error: message,
      },
    });
    return errorGitColumnCell(message);
  }
}

/** Lazy-load git summary for one workspace row; dedupes in-flight requests per path. */
export async function loadWorkspaceGitColumnCell(
  workspaceRootPath: string,
  options?: { force?: boolean },
): Promise<WorkspaceGitColumnCell> {
  if (!shouldLoadWorkspaceManagerGitColumn()) {
    return NEUTRAL_CELL;
  }

  // P03-08-07: serve a fresh cached cell without re-shelling-out. The view
  // re-runs its load effect on every `workspaces` array identity change, so
  // without this gate each list churn fanned out a blocking git process per row.
  if (!options?.force) {
    const cached = cellCacheByPath.get(workspaceRootPath);
    if (cached && Date.now() - cached.at < WORKSPACE_GIT_COLUMN_TTL_MS) {
      return cached.cell;
    }
  }

  if (options?.force) {
    inFlightByPath.delete(workspaceRootPath);
  }

  const existing = inFlightByPath.get(workspaceRootPath);
  if (existing) {
    return existing;
  }

  const promise = loadWorkspaceGitColumnCellInternal(workspaceRootPath)
    .then((cell) => {
      // P03-08-07: cache successful / neutral / error cells so a re-mount within
      // the TTL skips the git round-trip. Loading cells are not cached.
      cellCacheByPath.set(workspaceRootPath, { at: Date.now(), cell });
      return cell;
    })
    .finally(() => {
      inFlightByPath.delete(workspaceRootPath);
    });
  inFlightByPath.set(workspaceRootPath, promise);
  return promise;
}

/** Refresh git column cells for many workspaces concurrently (per-repo git queue still serializes same repo). */
export async function refreshWorkspaceGitColumnCells(
  workspaceRootPaths: readonly string[],
): Promise<Map<string, WorkspaceGitColumnCell>> {
  if (!shouldLoadWorkspaceManagerGitColumn()) {
    return new Map(workspaceRootPaths.map((workspaceRootPath) => [workspaceRootPath, NEUTRAL_CELL]));
  }

  const entries = await Promise.all(
    workspaceRootPaths.map(async (workspaceRootPath) => [
      workspaceRootPath,
      await loadWorkspaceGitColumnCell(workspaceRootPath, { force: true }),
    ] as const),
  );
  return new Map(entries);
}

/** Reset module in-flight + cache state (tests only). */
export function resetWorkspaceGitColumnQueueForTests(): void {
  inFlightByPath.clear();
  for (const timer of gitColumnRefreshTimers.values()) {
    clearTimeout(timer);
  }
  gitColumnRefreshTimers.clear();
  cellCacheByPath.clear();
}

/** True when a VC mutation should invalidate the workspace git column for that root. */
export function shouldRefreshGitColumnForMutation(_scope: VersionControlMutationScope): boolean {
  return true;
}

/**
 * Subscribe to version-control mutations and debounce git column reloads per workspace.
 * Returns an unsubscribe function that clears pending debounce timers.
 */
export function subscribeWorkspaceGitColumnAutoRefresh(
  onRefresh: (workspaceRootPath: string) => void,
): () => void {
  const unsubscribeMutations = subscribeVersionControlMutations((workspaceRootPath, scope) => {
    if (!shouldRefreshGitColumnForMutation(scope)) {
      return;
    }
    // P03-08-07: a mutation invalidates the cached cell so the debounced
    // refresh (which passes `force`) re-reads git instead of serving stale data.
    invalidateWorkspaceGitColumnCell(workspaceRootPath);

    const existing = gitColumnRefreshTimers.get(workspaceRootPath);
    if (existing) {
      clearTimeout(existing);
    }

    gitColumnRefreshTimers.set(
      workspaceRootPath,
      setTimeout(() => {
        gitColumnRefreshTimers.delete(workspaceRootPath);
        onRefresh(workspaceRootPath);
      }, GIT_COLUMN_REFRESH_DEBOUNCE_MS),
    );
  });

  return () => {
    unsubscribeMutations();
    for (const timer of gitColumnRefreshTimers.values()) {
      clearTimeout(timer);
    }
    gitColumnRefreshTimers.clear();
  };
}
