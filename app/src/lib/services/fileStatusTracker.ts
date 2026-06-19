import type { Readable } from "svelte/store";
import {
  type OpencodeFileChangeStatus,
  type OpencodeFileStatusEntry,
} from "../ai/backends/workspaceAgentBackend";
import { createReactiveResourceStore } from "../ai/opencodeResourceStore";

/**
 * M5-T3 — workspace file-change tracker. Wraps `file.status` (git working
 * tree) with a per-workspace reactive store. The `ProjectTreeView` reads the
 * `statusByPath` map to badge modified / new / deleted files.
 *
 * Status entries from OpenCode carry workspace-relative paths; callers
 * resolve them to absolute paths (matching the project-tree convention) via
 * `resolveAbsoluteStatusMap`.
 *
 * M10-T1: the cache + inflight + diagnostic skeleton now lives in
 * `createReactiveResourceStore`. The `copyEmptyState` override allocates a
 * fresh `new Map()` per cache entry so a consumer mutating a pre-refresh
 * snapshot's `statusByPath` can't corrupt the singleton (M10-T3).
 */

export type FileStatusTrackerStatus = "idle" | "loading" | "loaded" | "error";

export interface FileStatusTrackerState {
  status: FileStatusTrackerStatus;
  /** Absolute workspace path → change status. */
  statusByPath: Map<string, OpencodeFileChangeStatus>;
  lastErrorMessage: string | null;
  loadedAt: string | null;
}

const emptyState: FileStatusTrackerState = {
  status: "idle",
  statusByPath: new Map(),
  lastErrorMessage: null,
  loadedAt: null,
};

const store = createReactiveResourceStore<FileStatusTrackerState, string>({
  diagnosticLabel: "file status",
  diagnosticKind: "opencode.file.status.refresh",
  reactive: true,
  keyOf: (workspaceRootPath) => workspaceRootPath,
  diagnosticExtra: (workspaceRootPath) => ({ workspaceRootPath }),
  // M10-T3: fresh Map per cache entry — the state holds a mutable Map, so a
  // shallow spread of `emptyState` would alias the singleton Map across every
  // workspace. Allocate a new one each time.
  copyEmptyState: () => ({ ...emptyState, statusByPath: new Map() }),
  disabledState: () => ({ ...emptyState, statusByPath: new Map() }),
  buildLoadingState: (prior) => ({ ...prior, status: "loading" }),
  buildErrorState: (message) => ({
    ...emptyState,
    statusByPath: new Map(),
    status: "error",
    lastErrorMessage: message,
    loadedAt: null,
  }),
  async fetch(backend, workspaceRootPath) {
    const entries = await backend.listFileStatuses({ workspaceRootPath });
    const statusByPath = resolveAbsoluteStatusMap(workspaceRootPath, entries);
    return {
      status: "loaded",
      statusByPath,
      lastErrorMessage: null,
      loadedAt: new Date().toISOString(),
    };
  },
});

export function getFileStatusTracker(workspaceRootPath: string): Readable<FileStatusTrackerState> {
  return store.getReadable(workspaceRootPath);
}

export function getFileStatusSnapshot(workspaceRootPath: string): FileStatusTrackerState {
  return store.getSnapshot(workspaceRootPath);
}

export function resetFileStatusTrackerForTests(): void {
  store.resetForTests();
}

export async function refreshFileStatuses(input: {
  workspaceRootPath: string;
}): Promise<FileStatusTrackerState> {
  return store.refresh(input.workspaceRootPath);
}

export function clearFileStatusTracker(workspaceRootPath: string): void {
  store.clear(workspaceRootPath);
}

// -- Pure helpers (exposed for tests + the tree view) -------------------------

/**
 * Resolves workspace-relative `file.status` paths to absolute paths keyed in
 * a map. Absolute source paths are passed through; empty roots fall back to
 * the relative path verbatim. Duplicate paths keep the last entry.
 */
export function resolveAbsoluteStatusMap(
  workspaceRootPath: string,
  entries: readonly OpencodeFileStatusEntry[],
): Map<string, OpencodeFileChangeStatus> {
  const root = workspaceRootPath.replace(/\/+$/, "");
  const map = new Map<string, OpencodeFileChangeStatus>();
  for (const entry of entries) {
    const trimmed = entry.path.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const absolute = trimmed.startsWith("/") ? trimmed : `${root}/${trimmed}`;
    map.set(absolute, entry.status);
  }
  return map;
}

/** One-letter badge label for a status (M / A / D). */
export function fileStatusBadgeLabel(status: OpencodeFileChangeStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
  }
}

export interface FileStatusCounts {
  modified: number;
  added: number;
  deleted: number;
  total: number;
}

export function summarizeFileStatuses(
  statusByPath: ReadonlyMap<string, OpencodeFileChangeStatus>,
): FileStatusCounts {
  const counts: FileStatusCounts = { modified: 0, added: 0, deleted: 0, total: 0 };
  for (const status of statusByPath.values()) {
    counts.total += 1;
    if (status === "modified") {
      counts.modified += 1;
    } else if (status === "added") {
      counts.added += 1;
    } else if (status === "deleted") {
      counts.deleted += 1;
    }
  }
  return counts;
}
