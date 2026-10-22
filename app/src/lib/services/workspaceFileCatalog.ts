/**
 * Workspace-scoped openable-file catalog with generation cancellation,
 * loading/error state, disposal, and watcher invalidation.
 * Does not read file contents during construction.
 */

import { normalizePathForStorage, normalizePathSync } from "./diskFingerprint";
import {
  enumerateOpenableWorkspaceFiles,
  normalizeWorkspaceRoot,
  relativePathFromRoot,
  shouldSkipHeavyDirectoryName,
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
  /** Slash-normalized absolute path (original casing preserved). */
  absolutePath: string;
  /** Path relative to the workspace root (forward slashes, casing preserved). */
  relativePath: string;
  basename: string;
  /** Parent directory absolute path. */
  directory: string;
  /** Stable case-folded comparison key. */
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
  /**
   * Called before a forced rebuild (refresh / debounced watcher rebuild), with
   * the workspace root being rebuilt. Use this to scope invalidation to the
   * rebuilding root only (e.g. drop directory-cache entries under that root)
   * rather than clearing caches for every open workspace.
   */
  onBeforeRebuild?: (root: string) => void;
  /**
   * Resolves what is on disk at `path` after a rename or create event, or
   * null when it cannot tell. Lets renames (including atomic saves) update the
   * catalog in place; without it every rename schedules a full rebuild.
   */
  statPath?: (path: string) => Promise<"file" | "directory" | "missing" | null>;
}

export interface WorkspaceFileCatalog {
  getSnapshot(): WorkspaceFileCatalogSnapshot;
  /** Openable absolute paths when ready; otherwise null. */
  getOpenablePaths(): readonly string[] | null;
  subscribe(listener: () => void): () => void;
  /** Switch workspace (or null to clear). Cancels in-flight enumeration. */
  setWorkspaceRoot(root: string | null): void;
  /** Start enumeration when bound to a root but still idle. No-op when ready/loading. */
  ensureReady(): void;
  /** Resolves when the catalog is ready, errored, idle, or disposed. */
  waitForReady(): Promise<void>;
  /** Force a rebuild of the current workspace. */
  refresh(): void;
  /**
   * Watcher hint. When `kind` is supplied, applies a safe incremental update
   * (remove the deleted entry, add a newly created openable file); otherwise
   * (or for other/directory events) schedules a debounced rebuild. Modify
   * events are ignored, and renames are resolved with `statPath` when given.
   * Repeated bursts collapse into at most one rebuild.
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

/**
 * True when a path would be skipped by the full workspace traversal
 * (dot segments, heavy dirs like node_modules). Used so incremental watcher
 * creates cannot inject entries the rebuild would never list.
 */
export function shouldSkipCatalogPath(root: string, normalizedPath: string): boolean {
  const relative = relativePathFromRoot(normalizedPath, root);
  if (!relative) {
    return true;
  }
  const segments = relative.split("/").filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment.startsWith(".")) {
      return true;
    }
    // Heavy-dir names apply to parent directories only (same as full enumeration).
    if (index < segments.length - 1 && shouldSkipHeavyDirectoryName(segment)) {
      return true;
    }
  }
  return false;
}

function toEntry(root: string, absolutePath: string): WorkspaceFileEntry {
  // Keep the real on-disk casing for the path fields (they feed open requests,
  // tab file paths, and Copy Path); fold case only into the comparison key.
  const path = normalizePathForStorage(absolutePath);
  return {
    absolutePath: path,
    relativePath: relativePathFromRoot(path, root),
    basename: basenameOf(path),
    directory: directoryOf(path),
    key: normalizePathSync(path),
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
  const onBeforeRebuild = deps.onBeforeRebuild;
  const statPath = deps.statPath;

  let disposed = false;
  let generation = 0;
  let workspaceRoot: string | null = null;
  let status: WorkspaceFileCatalogStatus = "idle";
  let entries: WorkspaceFileEntry[] = [];
  /** Keys of {@link entries}, kept in sync so watcher updates avoid linear scans. */
  let entryKeys = new Set<string>();
  let partialErrors: string[] = [];
  let errorMessage: string | null = null;
  let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
  /** A watcher rebuild came due while an enumeration was still running. */
  let rebuildAfterLoad = false;
  const listeners = new Set<() => void>();
  /** Latest watcher event per key, so a slow rename stat cannot undo a newer event. */
  const eventSeqByKey = new Map<string, number>();
  let eventSeq = 0;

  // Diagnostics counters for incremental invalidation. No file contents.
  let incrementalAdds = 0;
  let incrementalRemoves = 0;
  let debouncedRebuilds = 0;

  function setEntries(next: WorkspaceFileEntry[]): void {
    entries = next;
    entryKeys = new Set(next.map((entry) => entry.key));
  }

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
      if (disposed || !workspaceRoot) {
        return;
      }
      // Never cancel an enumeration that is still running: on a large or busy
      // workspace a steady trickle of watcher events would restart it forever
      // and the catalog would never become ready. Rebuild once it finishes.
      if (status === "loading") {
        rebuildAfterLoad = true;
        return;
      }
      runWatcherRebuild(workspaceRoot);
    }, invalidateDebounceMs);
  }

  function runWatcherRebuild(root: string): void {
    debouncedRebuilds += 1;
    onBeforeRebuild?.(root);
    beginEnumerate(root);
  }

  /** Starts the rebuild deferred by {@link scheduleRebuild}, if one is pending. */
  function flushRebuildAfterLoad(root: string): void {
    if (!rebuildAfterLoad || disposed || workspaceRoot !== root) {
      return;
    }
    rebuildAfterLoad = false;
    runWatcherRebuild(root);
  }

  /** True when `path` is the root or nested under it (case-folded compare). */
  function pathIsUnderRoot(normalizedPath: string, root: string): boolean {
    const foldedRoot = normalizePathSync(root);
    return (
      normalizedPath === foldedRoot || normalizedPath.startsWith(`${foldedRoot}/`)
    );
  }

  /**
   * Synchronously remove an entry by normalized key. Returns true when the
   * entry set changed (caller emits + bumps diagnostics).
   */
  function removeEntry(normalizedPath: string): boolean {
    if (!entryKeys.has(normalizedPath)) {
      return false;
    }
    entries = entries.filter((entry) => entry.key !== normalizedPath);
    entryKeys.delete(normalizedPath);
    incrementalRemoves += 1;
    return true;
  }

  /**
   * Remove a file entry or every entry under a deleted directory prefix.
   */
  function removeEntryOrSubtree(normalizedPath: string): boolean {
    if (removeEntry(normalizedPath)) {
      return true;
    }
    const prefix = `${normalizedPath}/`;
    if (!entries.some((entry) => entry.key.startsWith(prefix))) {
      return false;
    }
    setEntries(entries.filter((entry) => !entry.key.startsWith(prefix)));
    incrementalRemoves += 1;
    return true;
  }

  /**
   * Synchronously add an entry for a newly created openable file. Returns true
   * when a new entry was inserted (caller emits + bumps diagnostics). No-ops
   * when the path is a directory (handled by debounced rebuild) or already
   * present, and never reads file contents. Accepts the raw watcher path —
   * casing is preserved for display, folding happens on the entry key.
   */
  function addEntry(root: string, path: string): boolean {
    const key = normalizePathSync(path);
    if (!isOpenableFilePath(path) || shouldSkipCatalogPath(root, path)) {
      return false;
    }
    if (entryKeys.has(key)) {
      return false;
    }
    // Entries stay sorted, so binary-insert instead of re-sorting the catalog.
    const entry = toEntry(root, path);
    let low = 0;
    let high = entries.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (entries[mid]!.absolutePath.localeCompare(entry.absolutePath) <= 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    const next = entries.slice();
    next.splice(low, 0, entry);
    entries = next;
    entryKeys.add(key);
    incrementalAdds += 1;
    return true;
  }

  function resolvePathChange(root: string, path: string, key: string, seq: number): void {
    const gen = generation;
    void statPath!(path)
      .catch(() => null)
      .then((kind) => {
        const current = eventSeqByKey.get(key) === seq;
        if (current) {
          eventSeqByKey.delete(key);
        }
        if (disposed || gen !== generation || workspaceRoot !== root || !current) {
          return;
        }
        if (status !== "ready" || kind === null || kind === "directory") {
          scheduleRebuild();
          return;
        }
        const changed =
          kind === "missing" ? removeEntryOrSubtree(key) : addEntry(root, path);
        if (changed) {
          emit();
        }
      });
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
    rebuildAfterLoad = false;
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
        setEntries(toEntries(root, result.paths));
        partialErrors = [...result.partialErrors];
        status = "ready";
        errorMessage = null;
        emit();
        flushRebuildAfterLoad(root);
      } catch (error: unknown) {
        if (disposed || gen !== generation) {
          return;
        }
        setEntries([]);
        partialErrors = [];
        status = "error";
        errorMessage = error instanceof Error ? error.message : String(error);
        emit();
        flushRebuildAfterLoad(root);
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
        setEntries([]);
        partialErrors = [];
        errorMessage = null;
        emit();
        return;
      }
      const normalized = normalizeWorkspaceRoot(root);
      if (workspaceRoot === normalized) {
        if (status === "ready" || status === "loading") {
          return;
        }
        return;
      }
      generation += 1;
      workspaceRoot = normalized;
      setEntries([]);
      partialErrors = [];
      errorMessage = null;
      status = "idle";
      emit();
    },

    ensureReady() {
      if (disposed || !workspaceRoot) {
        return;
      }
      if (status === "ready" || status === "loading") {
        return;
      }
      beginEnumerate(workspaceRoot);
    },

    waitForReady() {
      if (disposed || !workspaceRoot || status === "ready" || status === "error") {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const unsub = this.subscribe(() => {
          if (disposed || status === "ready" || status === "error" || !workspaceRoot) {
            unsub();
            resolve();
          }
        });
      });
    },

    refresh() {
      if (disposed || !workspaceRoot) {
        return;
      }
      clearInvalidateTimer();
      onBeforeRebuild?.(workspaceRoot);
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
          if (kind === "modify") {
            // Content and metadata changes cannot change the set of files.
            return;
          }
          // A newer event supersedes any rename still waiting on its stat.
          eventSeqByKey.delete(normalizedChanged);
          if (kind === "remove") {
            if (removeEntryOrSubtree(normalizedChanged)) {
              emit();
            }
            return;
          }
          // Match full enumeration: ignore events under skipped dirs/dot
          // segments so npm install etc. cannot flood the catalog or force
          // a rebuild for paths that would never be listed.
          if (shouldSkipCatalogPath(root, normalizedChanged)) {
            return;
          }
          if (kind === "create") {
            if (addEntry(root, changedPath)) {
              emit();
            }
            if (entryKeys.has(normalizedChanged)) {
              return;
            }
          }
          // A rename only says the path appeared or disappeared (an atomic
          // save renames over the target), and a create addEntry rejected may
          // be a directory or a non-openable file: check what is on disk.
          // Without a stat dependency, fall through to a debounced rebuild so
          // nested new files are picked up.
          if ((kind === "create" || kind === "rename") && statPath) {
            eventSeq += 1;
            eventSeqByKey.set(normalizedChanged, eventSeq);
            resolvePathChange(root, changedPath, normalizedChanged, eventSeq);
            return;
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
      setEntries([]);
      partialErrors = [];
      errorMessage = null;
      incrementalAdds = 0;
      incrementalRemoves = 0;
      debouncedRebuilds = 0;
      // Notify pending waitForReady() waiters *before* dropping them — the
      // listener callback observes `disposed` and resolves; clearing first
      // would strand those promises (and any search awaiting them) forever.
      emit();
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
