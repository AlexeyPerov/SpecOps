/**
 * Shared workspace traversal policy for project tree, file catalog, and search.
 * Enumerates openable files without reading file contents.
 */

import { readDir, type DirEntry } from "@tauri-apps/plugin-fs";
import { isOpenableFilePath } from "../editor/editorLanguage";
import { normalizePathForStorage, normalizePathSync } from "./diskFingerprint";

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

/**
 * Slash-normalized workspace root with original casing preserved — used as the
 * traversal root and for display forms. Case-fold only when comparing paths
 * (see `normalizePathSync`).
 */
export function normalizeWorkspaceRoot(rootPath: string): string {
  return normalizePathForStorage(rootPath).replace(/[\\/]+$/, "");
}

export function relativePathFromRoot(absolutePath: string, workspaceRoot: string): string {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const path = normalizePathForStorage(absolutePath);
  const compareRoot = normalizePathSync(root);
  const comparePath = normalizePathSync(path);
  if (comparePath === compareRoot) {
    return "";
  }
  if (comparePath.startsWith(`${compareRoot}/`)) {
    // Slice the case-preserving form (same segment layout as the folded key)
    // so displayed relative paths keep the real on-disk casing.
    return path.slice(root.length + 1);
  }
  return path;
}

export interface EnumerateOpenableFilesOptions {
  /** Tree filters may include hidden entries, while heavy directories remain excluded. */
  showHidden?: boolean;
  acceptsPath?: (path: string) => boolean;
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
const MAX_TRAVERSAL_ENTRIES = 100_000;
/** Directory listings in flight at once during enumeration. */
const TRAVERSAL_CONCURRENCY = 8;

type PendingDirectory = { path: string; depth: number };

/**
 * Recursively enumerate matching file paths under a workspace root.
 * Does not read file contents. Unreadable directories are skipped and recorded.
 */
export async function enumerateWorkspaceFiles(
  rootPath: string,
  options: EnumerateOpenableFilesOptions = {},
): Promise<EnumerateOpenableFilesResult> {
  const skipSymlinks = options.skipSymlinks !== false;
  const root = normalizeWorkspaceRoot(rootPath);
  const paths: string[] = [];
  const partialErrors: string[] = [];
  let truncated = false;
  let visitedEntries = 0;
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
  async function visit(directoryPath: string, depth: number, pending: PendingDirectory[]): Promise<void> {
    let entries: WorkspaceListEntry[];
    try {
      entries = await readDirFn(directoryPath);
    } catch {
      partialErrors.push(directoryPath);
      return;
    }

    for (const raw of entries) {
      if (options.isCancelled?.()) {
        return;
      }
      if (visitedEntries >= MAX_TRAVERSAL_ENTRIES) {
        truncated = true;
        return;
      }
      visitedEntries += 1;
      // A single very wide directory must not monopolize the WebView thread.
      if (visitedEntries % 2048 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const entry = raw as WorkspaceListEntry;
      if (skipSymlinks && entry.isSymlink) {
        continue;
      }
      if (entry.isDirectory) {
        if (options.showHidden ? (entryIsHidden(entry) || shouldSkipHeavyDirectoryName(entry.name)) : shouldSkipDirectoryEntry(entry)) {
          continue;
        }
        if (depth >= MAX_TRAVERSAL_DEPTH) {
          truncated = true;
          continue;
        }
        pending.push({ path: joinDirectoryPath(directoryPath, entry.name), depth: depth + 1 });
        continue;
      }
      if (options.showHidden ? entryIsHidden(entry) : shouldSkipFileEntry(entry)) {
        continue;
      }
      const path = joinDirectoryPath(directoryPath, entry.name);
      if ((options.acceptsPath ?? isOpenableFilePath)(path)) {
        paths.push(path);
      }
    }
  }

  // Each listing is one IPC round trip, so keep a few in flight instead of
  // walking strictly one directory at a time. Output order does not matter:
  // paths are sorted below.
  const pending: PendingDirectory[] = [{ path: root, depth: 0 }];
  await new Promise<void>((resolve) => {
    let active = 0;
    const pump = (): void => {
      const stopped =
        options.isCancelled?.() === true || visitedEntries >= MAX_TRAVERSAL_ENTRIES;
      while (!stopped && active < TRAVERSAL_CONCURRENCY && pending.length > 0) {
        const next = pending.pop()!;
        active += 1;
        void visit(next.path, next.depth, pending).finally(() => {
          active -= 1;
          pump();
        });
      }
      if (active === 0 && (stopped || pending.length === 0)) {
        if (visitedEntries >= MAX_TRAVERSAL_ENTRIES && pending.length > 0) {
          truncated = true;
        }
        resolve();
      }
    };
    pump();
  });

  if (options.isCancelled?.()) {
    return { paths: [], partialErrors, cancelled: true };
  }
  paths.sort((a, b) => a.localeCompare(b));
  return { paths, partialErrors, cancelled: false, truncated };
}

/** Editor catalog keeps its existing file eligibility independently of tree filters. */
export function enumerateOpenableWorkspaceFiles(
  rootPath: string, options: EnumerateOpenableFilesOptions = {},
): Promise<EnumerateOpenableFilesResult> {
  return enumerateWorkspaceFiles(rootPath, { ...options, acceptsPath: isOpenableFilePath });
}
