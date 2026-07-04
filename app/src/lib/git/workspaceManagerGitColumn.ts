import { checkGitAvailable, resolveRepoRoot } from "./gitService";
import {
  queryRepositoryStatusSummary,
  type RepositoryStatusSummary,
} from "./repositoryStatusSummary";

export type WorkspaceGitColumnCell =
  | { status: "loading" }
  | { status: "neutral"; text: "—" }
  | { status: "ready"; summary: RepositoryStatusSummary; displayText: string }
  | { status: "error"; text: "—" };

const NEUTRAL_CELL: WorkspaceGitColumnCell = { status: "neutral", text: "—" };
const ERROR_CELL: WorkspaceGitColumnCell = { status: "error", text: "—" };

let gitCommandQueue: Promise<unknown> = Promise.resolve();

function enqueueGitCommand<T>(fn: () => Promise<T>): Promise<T> {
  const next = gitCommandQueue.then(fn, fn);
  gitCommandQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

const inFlightByPath = new Map<string, Promise<WorkspaceGitColumnCell>>();

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
  } catch {
    return ERROR_CELL;
  }
}

/** Lazy-load git summary for one workspace row; dedupes in-flight requests per path. */
export async function loadWorkspaceGitColumnCell(
  workspaceRootPath: string,
  options?: { force?: boolean },
): Promise<WorkspaceGitColumnCell> {
  if (options?.force) {
    inFlightByPath.delete(workspaceRootPath);
  }

  const existing = inFlightByPath.get(workspaceRootPath);
  if (existing) {
    return existing;
  }

  const promise = enqueueGitCommand(() =>
    loadWorkspaceGitColumnCellInternal(workspaceRootPath),
  ).finally(() => {
    inFlightByPath.delete(workspaceRootPath);
  });
  inFlightByPath.set(workspaceRootPath, promise);
  return promise;
}

/** Refresh git column cells for many workspaces sequentially. */
export async function refreshWorkspaceGitColumnCells(
  workspaceRootPaths: readonly string[],
): Promise<Map<string, WorkspaceGitColumnCell>> {
  const results = new Map<string, WorkspaceGitColumnCell>();
  for (const workspaceRootPath of workspaceRootPaths) {
    results.set(
      workspaceRootPath,
      await loadWorkspaceGitColumnCell(workspaceRootPath, { force: true }),
    );
  }
  return results;
}

/** Reset module queue state (tests only). */
export function resetWorkspaceGitColumnQueueForTests(): void {
  gitCommandQueue = Promise.resolve();
  inFlightByPath.clear();
}
