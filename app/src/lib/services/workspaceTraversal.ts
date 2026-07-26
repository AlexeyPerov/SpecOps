/**
 * Shared workspace traversal policy for project tree, file catalog, and search.
 * Enumerates openable files without reading file contents.
 */

import { readDir, type DirEntry } from "@tauri-apps/plugin-fs";
import { isOpenableFilePath } from "../editor/editorLanguage";
import { normalizePathSync } from "./diskFingerprint";

export const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  ".venv",
  "__pycache__",
]);

export type WorkspaceListEntry = Pick<DirEntry, "name" | "isDirectory" | "isFile"> & {
  isHidden?: boolean;
  isSymlink?: boolean;
};

function entryIsHidden(entry: WorkspaceListEntry): boolean {
  return entry.isHidden === true;
}

export function shouldSkipDirectoryEntry(entry: WorkspaceListEntry): boolean {
  if (!entry.isDirectory) {
    return false;
  }
  const name = entry.name;
  if (name.startsWith(".")) {
    return true;
  }
  if (entryIsHidden(entry)) {
    return true;
  }
  return SKIPPED_DIRECTORY_NAMES.has(name.toLowerCase());
}

export function shouldSkipFileEntry(entry: WorkspaceListEntry): boolean {
  if (entry.isDirectory) {
    return false;
  }
  const name = entry.name;
  if (name.startsWith(".")) {
    return true;
  }
  if (entryIsHidden(entry)) {
    return true;
  }
  return false;
}

/** Heavy dirs skipped even when the tree shows hidden files. */
export function shouldSkipHeavyDirectoryName(name: string): boolean {
  return SKIPPED_DIRECTORY_NAMES.has(name.toLowerCase());
}

export function joinDirectoryPath(directoryPath: string, name: string): string {
  const base = directoryPath.replace(/[\\/]+$/, "");
  return `${base}/${name}`;
}

export function normalizeWorkspaceRoot(rootPath: string): string {
  return normalizePathSync(rootPath).replace(/[\\/]+$/, "");
}

export function relativePathFromRoot(absolutePath: string, workspaceRoot: string): string {
  const normalizedRoot = normalizeWorkspaceRoot(workspaceRoot);
  const normalizedPath = normalizePathSync(absolutePath);
  if (normalizedPath === normalizedRoot) {
    return "";
  }
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return normalizedPath;
}

export interface EnumerateOpenableFilesOptions {
  /** Return true to abort; checked between directories. */
  isCancelled?: () => boolean;
  /** Skip symlink entries (default true — shared with project tree). */
  skipSymlinks?: boolean;
  /** Injectable directory listing (e.g. shared workspace directory cache). */
  readDir?: (path: string) => Promise<WorkspaceListEntry[]>;
}

export interface EnumerateOpenableFilesResult {
  paths: string[];
  /** Absolute paths of directories that could not be read (non-fatal). */
  partialErrors: string[];
  cancelled: boolean;
  /** True when the walk stopped early at a depth or entry-count cap. */
  truncated?: boolean;
}

/**
 * Traversal safety caps (H27). A pathological tree (symlink cycles surviving
 * the skip rules, or a root accidentally pointed at `$HOME`) should degrade to
 * a partial catalog, not an unbounded walk.
 */
const MAX_TRAVERSAL_DEPTH = 64;
const MAX_ENUMERATED_FILES = 100_000;

/**
 * Recursively enumerate openable file paths under a workspace root.
 * Does not read file contents. Unreadable directories are skipped and recorded.
 */
export async function enumerateOpenableWorkspaceFiles(
  rootPath: string,
  options: EnumerateOpenableFilesOptions = {},
): Promise<EnumerateOpenableFilesResult> {
  const skipSymlinks = options.skipSymlinks !== false;
  const root = normalizeWorkspaceRoot(rootPath);
  const paths: string[] = [];
  const partialErrors: string[] = [];
  let truncated = false;
  const readDirFn =
    options.readDir ??
    (async (directoryPath: string) => {
      const entries = await readDir(directoryPath);
      return entries as WorkspaceListEntry[];
    });

  // Paths are joined synchronously: `@tauri-apps/api/path.join` is one IPC
  // round-trip per call, which made enumeration cost one hop per directory
  // entry on large trees (H27). `directoryPath` descends from a normalized
  // root, so plain string concatenation is equivalent.
  async function walk(directoryPath: string, depth: number): Promise<boolean> {
    if (options.isCancelled?.()) {
      return false;
    }

    let entries: WorkspaceListEntry[];
    try {
      entries = await readDirFn(directoryPath);
    } catch {
      partialErrors.push(directoryPath);
      return true;
    }

    for (const raw of entries) {
      if (options.isCancelled?.()) {
        return false;
      }
      if (paths.length >= MAX_ENUMERATED_FILES) {
        truncated = true;
        return true;
      }
      const entry = raw as WorkspaceListEntry;
      if (skipSymlinks && entry.isSymlink) {
        continue;
      }
      if (entry.isDirectory) {
        if (shouldSkipDirectoryEntry(entry)) {
          continue;
        }
        if (depth >= MAX_TRAVERSAL_DEPTH) {
          truncated = true;
          continue;
        }
        const childPath = joinDirectoryPath(directoryPath, entry.name);
        const ok = await walk(childPath, depth + 1);
        if (!ok) {
          return false;
        }
        continue;
      }
      if (shouldSkipFileEntry(entry)) {
        continue;
      }
      const path = joinDirectoryPath(directoryPath, entry.name);
      if (isOpenableFilePath(path)) {
        paths.push(path);
      }
    }
    return true;
  }

  const completed = await walk(root, 0);
  if (!completed) {
    return { paths: [], partialErrors, cancelled: true };
  }
  paths.sort((a, b) => a.localeCompare(b));
  return { paths, partialErrors, cancelled: false, truncated };
}
