import type { WorkingTreeDiffSource, WorkingTreeFileEntry } from "./types";

export interface WorkingTreeDiffSelection {
  path: string | null;
  source: WorkingTreeDiffSource | null;
}

export interface ResolveWorkingTreeDiffSelectionInput {
  path: string | null;
  source: WorkingTreeDiffSource | null;
  unstaged: WorkingTreeFileEntry[];
  staged: WorkingTreeFileEntry[];
}

/** Default diff target after status load: first unstaged file, else first staged. */
export function pickDefaultWorkingTreeDiffSelection(
  unstaged: WorkingTreeFileEntry[],
  staged: WorkingTreeFileEntry[],
): WorkingTreeDiffSelection {
  if (unstaged.length > 0) {
    return { path: unstaged[0]!.path, source: "unstaged" };
  }
  if (staged.length > 0) {
    return { path: staged[0]!.path, source: "staged" };
  }
  return { path: null, source: null };
}

function listContainsPath(
  entries: WorkingTreeFileEntry[],
  path: string,
): boolean {
  return entries.some((entry) => entry.path === path);
}

/**
 * Resolve which list should drive the diff for the active path.
 * Keeps explicit list context when the path exists in both staged and unstaged
 * (partial stage / MM). Re-resolves source when the path moved lists after a
 * mutation. Falls back to the default selection when the path disappears.
 */
export function resolveWorkingTreeDiffSelection(
  input: ResolveWorkingTreeDiffSelectionInput,
): WorkingTreeDiffSelection {
  const { path, source, unstaged, staged } = input;

  if (path) {
    if (source === "unstaged" && listContainsPath(unstaged, path)) {
      return { path, source: "unstaged" };
    }
    if (source === "staged" && listContainsPath(staged, path)) {
      return { path, source: "staged" };
    }
    if (listContainsPath(unstaged, path)) {
      return { path, source: "unstaged" };
    }
    if (listContainsPath(staged, path)) {
      return { path, source: "staged" };
    }
  }

  return pickDefaultWorkingTreeDiffSelection(unstaged, staged);
}

/** Lookup the status row shown in the active staged/unstaged list. */
export function findWorkingTreeEntryForDiff(
  path: string,
  source: WorkingTreeDiffSource,
  unstaged: WorkingTreeFileEntry[],
  staged: WorkingTreeFileEntry[],
): WorkingTreeFileEntry | null {
  const entries = source === "unstaged" ? unstaged : staged;
  return entries.find((entry) => entry.path === path) ?? null;
}
