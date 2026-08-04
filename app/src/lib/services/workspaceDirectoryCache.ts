/**
 * Shared per-process directory listing cache for project tree and file catalog.
 * Coalesces concurrent readDir calls for the same path and invalidates on
 * watcher hints or explicit refresh.
 */

import { readDir, type DirEntry } from "@tauri-apps/plugin-fs";
import { normalizePathForStorage, normalizePathSync } from "./diskFingerprint";
import {
  enumerateOpenableWorkspaceFiles,
  type EnumerateOpenableFilesResult,
} from "./workspaceTraversal";
import {
  loadDirectoryChildren,
  type LoadDirectoryChildrenOptions,
} from "./projectTree";
import type { WorkspaceListEntry } from "./workspaceTraversal";

/** Soft cap so collapsed-tree walks cannot retain every directory forever. */
export const DEFAULT_DIRECTORY_CACHE_MAX_ENTRIES = 256;

export interface WorkspaceDirectoryCacheDeps {
  readDirFn?: (path: string) => Promise<DirEntry[]>;
  /** Maximum cached directory listings (LRU). Default: {@link DEFAULT_DIRECTORY_CACHE_MAX_ENTRIES}. */
  maxEntries?: number;
}

export interface WorkspaceDirectoryCache {
  readDir(path: string): Promise<WorkspaceListEntry[]>;
  invalidate(paths: readonly string[]): void;
  /**
   * Drop every cached listing at or under `prefix` (a workspace root). Use this
   * instead of {@link clear} when invalidating for a rebuild in one workspace,
   * so cached listings for other open workspaces survive the rebuild.
   */
  invalidateUnder(prefix: string): void;
  clear(): void;
  dispose(): void;
  /** Current number of retained listings (for tests). */
  size(): number;
}

function normalizeDirPath(path: string): string {
  return normalizePathSync(path).replace(/[\\/]+$/, "");
}

export function createWorkspaceDirectoryCache(
  deps: WorkspaceDirectoryCacheDeps = {},
): WorkspaceDirectoryCache {
  const readDirFn = deps.readDirFn ?? readDir;
  const maxEntries = deps.maxEntries ?? DEFAULT_DIRECTORY_CACHE_MAX_ENTRIES;
  // Insertion order = LRU order (oldest first). Re-get moves to the end.
  const cache = new Map<string, WorkspaceListEntry[]>();
  const inflight = new Map<string, Promise<WorkspaceListEntry[]>>();
  const generationByKey = new Map<string, number>();

  function touch(key: string, value: WorkspaceListEntry[]): void {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      cache.delete(oldest);
    }
  }

  async function readDirCached(path: string): Promise<WorkspaceListEntry[]> {
    const key = normalizeDirPath(path);
    const cached = cache.get(key);
    if (cached !== undefined) {
      touch(key, cached);
      return cached;
    }
    const pending = inflight.get(key);
    if (pending) {
      return pending;
    }
    const requestGeneration = generationByKey.get(key) ?? 0;
    const promise = readDirFn(normalizePathForStorage(path))
      .then((entries) => {
        if ((generationByKey.get(key) ?? 0) !== requestGeneration) {
          inflight.delete(key);
          return readDirCached(path);
        }
        const result = entries as WorkspaceListEntry[];
        touch(key, result);
        inflight.delete(key);
        return result;
      })
      .catch((error: unknown) => {
        inflight.delete(key);
        throw error;
      });
    inflight.set(key, promise);
    return promise;
  }

  return {
    readDir: readDirCached,
    invalidate(paths) {
      for (const path of paths) {
        const key = normalizeDirPath(path);
        generationByKey.set(key, (generationByKey.get(key) ?? 0) + 1);
        cache.delete(key);
        inflight.delete(key);
      }
    },
    invalidateUnder(prefix) {
      const normalizedPrefix = normalizeDirPath(prefix);
      for (const key of [...cache.keys(), ...inflight.keys()]) {
        if (key === normalizedPrefix || key.startsWith(`${normalizedPrefix}/`)) {
          generationByKey.set(key, (generationByKey.get(key) ?? 0) + 1);
          cache.delete(key);
          inflight.delete(key);
        }
      }
    },
    clear() {
      cache.clear();
      inflight.clear();
      generationByKey.clear();
    },
    dispose() {
      cache.clear();
      inflight.clear();
      generationByKey.clear();
    },
    size() {
      return cache.size;
    },
  };
}

export interface CachedWorkspaceTraversal {
  readDir(path: string): Promise<WorkspaceListEntry[]>;
  enumerate(
    rootPath: string,
    options: { isCancelled: () => boolean },
  ): Promise<EnumerateOpenableFilesResult>;
  loadDirectoryChildren: typeof loadDirectoryChildren;
}

export function createCachedWorkspaceTraversal(deps: {
  cache: WorkspaceDirectoryCache;
}): CachedWorkspaceTraversal {
  const readDir = (path: string) => deps.cache.readDir(path);
  return {
    readDir,
    enumerate: (rootPath, options) =>
      enumerateOpenableWorkspaceFiles(rootPath, { ...options, readDir }),
    loadDirectoryChildren: (
      workspaceRoot: string,
      dirPath: string,
      options: LoadDirectoryChildrenOptions,
    ) => loadDirectoryChildren(workspaceRoot, dirPath, { ...options, readDir }),
  };
}
