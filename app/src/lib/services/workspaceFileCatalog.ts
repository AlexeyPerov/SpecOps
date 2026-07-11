/**
 * Workspace-scoped openable-file catalog with generation cancellation,
 * loading/error state, disposal, and watcher invalidation.
 * Does not read file contents during construction.
 */

import { normalizePathSync } from "./diskFingerprint";
import {
  enumerateOpenableWorkspaceFiles,
  normalizeWorkspaceRoot,
  relativePathFromRoot,
  type EnumerateOpenableFilesResult,
} from "./workspaceTraversal";

export interface WorkspaceFileEntry {
  /** Normalized absolute path. */
  absolutePath: string;
  /** Path relative to the workspace root (forward slashes). */
  relativePath: string;
  basename: string;
  /** Parent directory absolute path. */
  directory: string;
  /** Stable key (= absolutePath). */
  key: string;
}

export type WorkspaceFileCatalogStatus = "idle" | "loading" | "ready" | "error";

export interface WorkspaceFileCatalogSnapshot {
  workspaceRoot: string | null;
  generation: number;
  status: WorkspaceFileCatalogStatus;
  entries: readonly WorkspaceFileEntry[];
  partialErrors: readonly string[];
  errorMessage: string | null;
}

export interface WorkspaceFileCatalogDeps {
  enumerate?: (
    rootPath: string,
    options: { isCancelled: () => boolean },
  ) => Promise<EnumerateOpenableFilesResult>;
  invalidateDebounceMs?: number;
}

export interface WorkspaceFileCatalog {
  getSnapshot(): WorkspaceFileCatalogSnapshot;
  /** Openable absolute paths when ready; otherwise null. */
  getOpenablePaths(): readonly string[] | null;
  subscribe(listener: () => void): () => void;
  /** Switch workspace (or null to clear). Cancels in-flight enumeration. */
  setWorkspaceRoot(root: string | null): void;
  /** Force a rebuild of the current workspace. */
  refresh(): void;
  /** Watcher hint — debounced rebuild of the current workspace. */
  notifyFilesystemChange(changedPath?: string): void;
  dispose(): void;
}

function basenameOf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function directoryOf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return normalized;
  }
  return normalized.slice(0, slash);
}

function toEntries(root: string, paths: readonly string[]): WorkspaceFileEntry[] {
  return paths.map((absolutePath) => {
    const normalized = normalizePathSync(absolutePath);
    return {
      absolutePath: normalized,
      relativePath: relativePathFromRoot(normalized, root),
      basename: basenameOf(normalized),
      directory: directoryOf(normalized),
      key: normalized,
    };
  });
}

const DEFAULT_INVALIDATE_DEBOUNCE_MS = 400;

export function createWorkspaceFileCatalog(
  deps: WorkspaceFileCatalogDeps = {},
): WorkspaceFileCatalog {
  const enumerate = deps.enumerate ?? enumerateOpenableWorkspaceFiles;
  const invalidateDebounceMs = deps.invalidateDebounceMs ?? DEFAULT_INVALIDATE_DEBOUNCE_MS;

  let disposed = false;
  let generation = 0;
  let workspaceRoot: string | null = null;
  let status: WorkspaceFileCatalogStatus = "idle";
  let entries: WorkspaceFileEntry[] = [];
  let partialErrors: string[] = [];
  let errorMessage: string | null = null;
  let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function clearInvalidateTimer(): void {
    if (invalidateTimer !== null) {
      clearTimeout(invalidateTimer);
      invalidateTimer = null;
    }
  }

  function snapshot(): WorkspaceFileCatalogSnapshot {
    return {
      workspaceRoot,
      generation,
      status,
      entries,
      partialErrors,
      errorMessage,
    };
  }

  function beginEnumerate(root: string): void {
    generation += 1;
    const gen = generation;
    status = "loading";
    errorMessage = null;
    emit();

    void (async () => {
      try {
        const result = await enumerate(root, {
          isCancelled: () => disposed || gen !== generation,
        });
        if (disposed || gen !== generation) {
          return;
        }
        if (result.cancelled) {
          return;
        }
        entries = toEntries(root, result.paths);
        partialErrors = [...result.partialErrors];
        status = "ready";
        errorMessage = null;
        emit();
      } catch (error: unknown) {
        if (disposed || gen !== generation) {
          return;
        }
        entries = [];
        partialErrors = [];
        status = "error";
        errorMessage = error instanceof Error ? error.message : String(error);
        emit();
      }
    })();
  }

  return {
    getSnapshot: snapshot,

    getOpenablePaths() {
      if (status !== "ready") {
        return null;
      }
      return entries.map((entry) => entry.absolutePath);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setWorkspaceRoot(root) {
      if (disposed) {
        return;
      }
      clearInvalidateTimer();
      if (!root) {
        generation += 1;
        workspaceRoot = null;
        status = "idle";
        entries = [];
        partialErrors = [];
        errorMessage = null;
        emit();
        return;
      }
      const normalized = normalizeWorkspaceRoot(root);
      if (workspaceRoot === normalized && (status === "ready" || status === "loading")) {
        return;
      }
      workspaceRoot = normalized;
      entries = [];
      partialErrors = [];
      beginEnumerate(normalized);
    },

    refresh() {
      if (disposed || !workspaceRoot) {
        return;
      }
      clearInvalidateTimer();
      beginEnumerate(workspaceRoot);
    },

    notifyFilesystemChange(changedPath) {
      if (disposed || !workspaceRoot) {
        return;
      }
      if (changedPath) {
        const normalizedChanged = normalizePathSync(changedPath);
        const root = workspaceRoot;
        if (
          normalizedChanged !== root &&
          !normalizedChanged.startsWith(`${root}/`)
        ) {
          return;
        }
      }
      clearInvalidateTimer();
      invalidateTimer = setTimeout(() => {
        invalidateTimer = null;
        if (!disposed && workspaceRoot) {
          beginEnumerate(workspaceRoot);
        }
      }, invalidateDebounceMs);
    },

    dispose() {
      disposed = true;
      clearInvalidateTimer();
      generation += 1;
      workspaceRoot = null;
      status = "idle";
      entries = [];
      partialErrors = [];
      errorMessage = null;
      listeners.clear();
    },
  };
}
