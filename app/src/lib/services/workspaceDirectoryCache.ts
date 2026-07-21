/**
 * Shared per-process directory listing cache for project tree and file catalog.
 * Coalesces concurrent readDir calls for the same path and invalidates on
 * watcher hints or explicit refresh.
 */

import { readDir, type DirEntry } from "@tauri-apps/plugin-fs";
import { normalizePathSync } from "./diskFingerprint";
import {
  enumerateOpenableWorkspaceFiles,
  type EnumerateOpenableFilesResult,
} from "./workspaceTraversal";
import {
  loadDirectoryChildren,
  type LoadDirectoryChildrenOptions,
} from "./projectTree";
import type { WorkspaceListEntry } from "./workspaceTraversal";

export interface WorkspaceDirectoryCacheDeps {
  readDirFn?: (path: string) => Promise<DirEntry[]>;
}

export interface WorkspaceDirectoryCache {
  readDir(path: string): Promise<WorkspaceListEntry[]>;
  invalidate(paths: readonly string[]): void;
  clear(): void;
  dispose(): void;
}

function normalizeDirPath(path: string): string {
  return normalizePathSync(path).replace(/[\\/]+$/, "");
}

export function createWorkspaceDirectoryCache(
  deps: WorkspaceDirectoryCacheDeps = {},
): WorkspaceDirectoryCache {
  const readDirFn = deps.readDirFn ?? readDir;
  const cache = new Map<string, WorkspaceListEntry[]>();
  const inflight = new Map<string, Promise<WorkspaceListEntry[]>>();

  async function readDirCached(path: string): Promise<WorkspaceListEntry[]> {
    const key = normalizeDirPath(path);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const pending = inflight.get(key);
    if (pending) {
      return pending;
    }
    const promise = readDirFn(key)
      .then((entries) => {
        const result = entries as WorkspaceListEntry[];
        cache.set(key, result);
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
        cache.delete(key);
        inflight.delete(key);
      }
    },
    clear() {
      cache.clear();
      inflight.clear();
    },
    dispose() {
      cache.clear();
      inflight.clear();
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
