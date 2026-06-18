import { writable, type Readable, type Writable } from "svelte/store";
import {
  createWorkspaceAgentBackend,
  type OpencodeFileChangeStatus,
  type OpencodeFileStatusEntry,
} from "../ai/backends/workspaceAgentBackend";
import { logDiagnostic } from "./logging";
import { appState } from "../state/appState";
import type { OpencodeTransportMode } from "../domain/contracts";
import { isOpencodeEnabled } from "./opencodeSettings";

/**
 * M5-T3 — workspace file-change tracker. Wraps `file.status` (git working
 * tree) with a per-workspace reactive store. The `ProjectTreeView` reads the
 * `statusByPath` map to badge modified / new / deleted files.
 *
 * Status entries from OpenCode carry workspace-relative paths; callers
 * resolve them to absolute paths (matching the project-tree convention) via
 * `resolveAbsoluteStatusMap`.
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

interface CachedStore {
  readable: Readable<FileStatusTrackerState>;
  set: (value: FileStatusTrackerState) => void;
  value: FileStatusTrackerState;
}

const storeCache = new Map<string, CachedStore>();
const inflightRequests = new Map<string, Promise<FileStatusTrackerState>>();

function getOrCreateStore(workspaceRootPath: string): CachedStore {
  const existing = storeCache.get(workspaceRootPath);
  if (existing) {
    return existing;
  }
  const store: Writable<FileStatusTrackerState> = writable<FileStatusTrackerState>(emptyState);
  const cached: CachedStore = {
    readable: { subscribe: store.subscribe },
    set: store.set,
    value: emptyState,
  };
  storeCache.set(workspaceRootPath, cached);
  return cached;
}

function setState(workspaceRootPath: string, next: FileStatusTrackerState): void {
  const cached = getOrCreateStore(workspaceRootPath);
  cached.value = next;
  cached.set(next);
}

export function getFileStatusTracker(
  workspaceRootPath: string,
): Readable<FileStatusTrackerState> {
  return getOrCreateStore(workspaceRootPath).readable;
}

export function getFileStatusSnapshot(
  workspaceRootPath: string,
): FileStatusTrackerState {
  return getOrCreateStore(workspaceRootPath).value;
}

export function resetFileStatusTrackerForTests(): void {
  storeCache.clear();
  inflightRequests.clear();
}

function resolveRuntimeConfig() {
  const { mode, baseUrl } = appState.getSnapshot().settings.opencode;
  return { mode, baseUrl };
}

function emitDiagnostic(input: {
  reason: string;
  workspaceRootPath: string;
  level?: "debug" | "warn";
  error?: unknown;
}): void {
  void logDiagnostic({
    level: input.level ?? "debug",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "file status refresh",
    metadata: {
      kind: "opencode.file.status.refresh",
      reason: input.reason,
      workspaceRootPath: input.workspaceRootPath,
      error: input.error instanceof Error ? input.error.message : undefined,
    },
  });
}

export async function refreshFileStatuses(input: {
  workspaceRootPath: string;
}): Promise<FileStatusTrackerState> {
  const { workspaceRootPath } = input;
  getOrCreateStore(workspaceRootPath);

  const existing = inflightRequests.get(workspaceRootPath);
  if (existing) {
    return existing;
  }

  const snapshot = appState.getSnapshot();
  if (!isOpencodeEnabled(snapshot.settings.opencode)) {
    const next: FileStatusTrackerState = { ...emptyState, statusByPath: new Map() };
    setState(workspaceRootPath, next);
    return next;
  }

  setState(workspaceRootPath, {
    ...getFileStatusSnapshot(workspaceRootPath),
    status: "loading",
  });

  const promise = (async (): Promise<FileStatusTrackerState> => {
    try {
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async (): Promise<{
          mode: OpencodeTransportMode;
          baseUrl: string;
        }> => resolveRuntimeConfig(),
      });
      const entries = await backend.listFileStatuses({
        workspaceRootPath,
      });
      const statusByPath = resolveAbsoluteStatusMap(workspaceRootPath, entries);
      const next: FileStatusTrackerState = {
        status: "loaded",
        statusByPath,
        lastErrorMessage: null,
        loadedAt: new Date().toISOString(),
      };
      setState(workspaceRootPath, next);
      emitDiagnostic({ reason: "loaded", workspaceRootPath });
      return next;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load file statuses.";
      const next: FileStatusTrackerState = {
        status: "error",
        statusByPath: new Map(),
        lastErrorMessage: message,
        loadedAt: null,
      };
      setState(workspaceRootPath, next);
      emitDiagnostic({ reason: "error", workspaceRootPath, level: "warn", error });
      return next;
    } finally {
      inflightRequests.delete(workspaceRootPath);
    }
  })();

  inflightRequests.set(workspaceRootPath, promise);
  return promise;
}

export function clearFileStatusTracker(workspaceRootPath: string): void {
  storeCache.delete(workspaceRootPath);
  inflightRequests.delete(workspaceRootPath);
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
