import { normalizeGitOutputPath, type WorkingTreeStatus } from "./types";

/** Project-tree badge status aligned with M/A/D labels. */
export type ProjectTreeFileChangeStatus = "added" | "deleted" | "modified";

/** Maps a porcelain status code to a project-tree badge status. */
export function mapPorcelainStatusCodeToBadge(
  statusCode: string,
): ProjectTreeFileChangeStatus | null {
  const code = statusCode.trim();
  if (!code) {
    return null;
  }

  if (code === "??") {
    return "added";
  }

  if (code.includes("D")) {
    return "deleted";
  }

  if (code.includes("R") || code.includes("C")) {
    return "modified";
  }

  if (code.includes("U")) {
    return "modified";
  }

  if (code.includes("A") && code.includes("M")) {
    return "modified";
  }

  if (code.includes("A")) {
    return "added";
  }

  if (code.includes("M")) {
    return "modified";
  }

  return "modified";
}

function toAbsoluteRepoPath(repoRoot: string, repoRelativePath: string): string {
  const root = normalizeGitOutputPath(repoRoot);
  const relative = repoRelativePath.replace(/^\/+/, "");
  return `${root}/${relative}`;
}

/**
 * Builds an absolute-path badge map from `git status --porcelain` output.
 * Paths are repo-root absolute so they match project-tree node paths.
 */
export function mapWorkingTreeStatusToAbsoluteBadges(
  repoRoot: string,
  status: WorkingTreeStatus,
): Map<string, ProjectTreeFileChangeStatus> {
  const statusCodeByRelativePath = new Map<string, string>();

  for (const entry of status.staged) {
    statusCodeByRelativePath.set(entry.path, entry.statusCode);
  }

  for (const entry of status.unstaged) {
    const existing = statusCodeByRelativePath.get(entry.path);
    if (existing) {
      statusCodeByRelativePath.set(entry.path, mergePorcelainStatusCodes(existing, entry.statusCode));
      continue;
    }
    statusCodeByRelativePath.set(entry.path, entry.statusCode);
  }

  const badges = new Map<string, ProjectTreeFileChangeStatus>();
  for (const [relativePath, statusCode] of statusCodeByRelativePath) {
    const badge = mapPorcelainStatusCodeToBadge(statusCode);
    if (!badge) {
      continue;
    }
    badges.set(toAbsoluteRepoPath(repoRoot, relativePath), badge);
  }

  return badges;
}

function mergePorcelainStatusCodes(stagedCode: string, unstagedCode: string): string {
  if (stagedCode === unstagedCode) {
    return stagedCode;
  }

  if (stagedCode.includes("D") || unstagedCode.includes("D")) {
    return stagedCode.includes("D") ? stagedCode : unstagedCode;
  }

  if (stagedCode === "??" || unstagedCode === "??") {
    return "??";
  }

  return unstagedCode.length >= stagedCode.length ? unstagedCode : stagedCode;
}
