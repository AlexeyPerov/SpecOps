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
import { isOpenableFilePath } from "../editor/editorLanguage";
import type { FileWatcherEventKind } from "./fileWatcher";

/**
 * Coarse change kind accepted by {@link WorkspaceFileCatalog.notifyFilesystemChange}.
 * Local alias so callers need not import the watcher module to pass `undefined`.
 */
export type CatalogFileChangeKind = FileWatcherEventKind | undefined;

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
  /**
   * Watcher hint. When `kind` is supplied, applies a safe incremental update
   * (remove the deleted entry, add a newly created openable file); otherwise
   * (or for rename/modify/other/directory events) schedules a debounced
   * rebuild. Repeated bursts collapse into at most one rebuild.
   */
  notifyFilesystemChange(changedPath?: string, kind?: FileWatcherEventKind): void;
  /** Non-fatal diagnostics counters (no file contents). */
  getDiagnostics(): WorkspaceFileCatalogDiagnostics;
  dispose(): void;
}

export interface WorkspaceFileCatalogDiagnostics {
  workspaceRoot: string | null;
  generation: number;
  status: WorkspaceFileCatalogStatus;
  entryCount: number;
  partialErrorCount: number;
  incrementalAdds: number;
  incrementalRemoves: number;
  debouncedRebuilds: number;
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

function toEntry(root: string, absolutePath: string): WorkspaceFileEntry {
  const normalized = normalizePathSync(absolutePath);
  return {
    absolutePath: normalized,
    relativePath: relativePathFromRoot(normalized, root),
    basename: basenameOf(normalized),
    directory: directoryOf(normalized),
    key: normalized,
  };
}

function toEntries(root: string, paths: readonly string[]): WorkspaceFileEntry[] {
  return paths.map((absolutePath) => toEntry(root, absolutePath));
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

  // Diagnostics counters for incremental invalidation. No file contents.
  let incrementalAdds = 0;
  let incrementalRemoves = 0;
  let debouncedRebuilds = 0;

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

  function scheduleRebuild(): void {
    clearInvalidateTimer();
    invalidateTimer = setTimeout(() => {
      invalidateTimer = null;
      if (!disposed && workspaceRoot) {
        debouncedRebuilds += 1;
        beginEnumerate(workspaceRoot);
      }
    }, invalidateDebounceMs);
  }

  /** True when `path` is the root or nested under it (post-normalization). */
  function pathIsUnderRoot(normalizedPath: string, root: string): boolean {
    return normalizedPath === root || normalizedPath.startsWith(`${root}/`);
  }

  /**
   * Synchronously remove an entry by normalized key. Returns true when the
   * entry set changed (caller emits + bumps diagnostics).
   */
  function removeEntry(normalizedPath: string): boolean {
    const next = entries.filter((entry) => entry.key !== normalizedPath);
    if (next.length === entries.length) {
      return false;
    }
    entries = next;
    incrementalRemoves += 1;
    return true;
  }

  /**
   * Synchronously add an entry for a newly created openable file. Returns true
   * when a new entry was inserted (caller emits + bumps diagnostics). No-ops
   * when the path is a directory (handled by debounced rebuild) or already
   * present, and never reads file contents.
   */
  function addEntry(root: string, normalizedPath: string): boolean {
    if (!isOpenableFilePath(normalizedPath)) {
      return false;
    }
    const existing = entries.find((entry) => entry.key === normalizedPath);
    if (existing) {
      return false;
    }
    const next = [...entries, toEntry(root, normalizedPath)];
    next.sort((a, b) => a.absolutePath.localeCompare(b.absolutePath));
    entries = next;
    incrementalAdds += 1;
    return true;
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

    notifyFilesystemChange(changedPath, kind) {
      if (disposed || !workspaceRoot) {
        return;
      }
      const root = workspaceRoot;
      // Skip events entirely outside the workspace root.
      if (changedPath) {
        const normalizedChanged = normalizePathSync(changedPath);
        if (!pathIsUnderRoot(normalizedChanged, root)) {
          return;
        }
        // Only apply incremental updates once the initial build is ready.
        // During loading, every event collapses into a single deferred rebuild.
        if (status === "ready" && kind) {
          if (kind === "remove") {
            if (removeEntry(normalizedChanged)) {
              emit();
            }
            return;
          }
          if (kind === "create") {
            if (addEntry(root, normalizedChanged)) {
              emit();
            }
            // If the created path is a directory, addEntry no-ops (the file
            // predicate rejects it) — fall through to a debounced rebuild so
            // nested new files are picked up.
            if (entries.some((entry) => entry.key === normalizedChanged)) {
              return;
            }
          }
        }
      }
      scheduleRebuild();
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
      incrementalAdds = 0;
      incrementalRemoves = 0;
      debouncedRebuilds = 0;
      listeners.clear();
    },

    getDiagnostics() {
      return {
        workspaceRoot,
        generation,
        status,
        entryCount: entries.length,
        partialErrorCount: partialErrors.length,
        incrementalAdds,
        incrementalRemoves,
        debouncedRebuilds,
      };
    },
  };
}
