import { join } from "@tauri-apps/api/path";
import { readDir, type DirEntry } from "@tauri-apps/plugin-fs";
import { normalizePathSync } from "./diskFingerprint";

/**
 * Pure helper for the Workspace Manager "Add multiple…" flow (decision 8).
 *
 * Given a parent directory path and the (normalized) root paths already in the
 * session, returns the immediate subfolder entries that are candidates for
 * batch-add: directories only (files skipped), with `exists` flagging whether a
 * folder is already open in the session (so the modal can exclude/disable it).
 *
 * `existingRootPaths` must contain paths normalized via
 * {@link normalizePathSync} (the same key the session dedup uses). The returned
 * `path` is the raw OS path (suitable for passing to `addWorkspace`, which
 * normalizes internally); `exists` is computed against the normalized form so it
 * matches the session dedup regardless of OS path casing.
 */
export interface ImmediateSubfolder {
  path: string;
  name: string;
  /** True when this subfolder's path is already open in the session. */
  exists: boolean;
}

export interface CollectImmediateSubfoldersDeps {
  readDir: (path: string) => Promise<DirEntry[]>;
  join: (...segments: string[]) => Promise<string>;
  /** Path-key normalizer matching the session dedup key. */
  normalizePath: (path: string) => string;
}

const DEFAULT_DEPS: CollectImmediateSubfoldersDeps = {
  readDir,
  join,
  normalizePath: normalizePathSync,
};

/**
 * Walks a single directory level and returns immediate subfolders. Symlinks
 * are skipped (consistent with the line-counter walker). The result is sorted
 * alphabetically by name for stable ordering in the modal.
 */
export async function collectImmediateSubfolders(
  parentPath: string,
  existingRootPaths: ReadonlySet<string>,
  deps: CollectImmediateSubfoldersDeps = DEFAULT_DEPS,
): Promise<ImmediateSubfolder[]> {
  const { readDir: readDirDeps, join: joinDeps, normalizePath } = deps;
  let entries: DirEntry[];
  try {
    entries = await readDirDeps(parentPath);
  } catch {
    return [];
  }

  const folders: ImmediateSubfolder[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory || entry.isSymlink) {
      continue;
    }
    const fullPath = await joinDeps(parentPath, entry.name);
    folders.push({
      path: fullPath,
      name: entry.name,
      exists: existingRootPaths.has(normalizePath(fullPath)),
    });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  return folders;
}
