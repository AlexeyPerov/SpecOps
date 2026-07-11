/**
 * Shared workspace traversal policy for project tree, file catalog, and search.
 * Enumerates openable files without reading file contents.
 */

import { join } from "@tauri-apps/api/path";
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
}

export interface EnumerateOpenableFilesResult {
  paths: string[];
  /** Absolute paths of directories that could not be read (non-fatal). */
  partialErrors: string[];
  cancelled: boolean;
}

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

  async function walk(directoryPath: string): Promise<boolean> {
    if (options.isCancelled?.()) {
      return false;
    }

    let entries: DirEntry[];
    try {
      entries = await readDir(directoryPath);
    } catch {
      partialErrors.push(directoryPath);
      return true;
    }

    for (const raw of entries) {
      if (options.isCancelled?.()) {
        return false;
      }
      const entry = raw as WorkspaceListEntry;
      if (skipSymlinks && entry.isSymlink) {
        continue;
      }
      if (entry.isDirectory) {
        if (shouldSkipDirectoryEntry(entry)) {
          continue;
        }
        const childPath = await join(directoryPath, entry.name);
        const ok = await walk(childPath);
        if (!ok) {
          return false;
        }
        continue;
      }
      if (shouldSkipFileEntry(entry)) {
        continue;
      }
      const path = await join(directoryPath, entry.name);
      if (isOpenableFilePath(path)) {
        paths.push(path);
      }
    }
    return true;
  }

  const completed = await walk(root);
  if (!completed) {
    return { paths: [], partialErrors, cancelled: true };
  }
  paths.sort((a, b) => a.localeCompare(b));
  return { paths, partialErrors, cancelled: false };
}
