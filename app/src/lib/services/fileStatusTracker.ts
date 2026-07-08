import { writable, type Readable, type Writable } from "svelte/store";
import { formatGitErrorPrimaryMessage } from "../git/gitErrorUi";
import { logDiagnostic } from "./logging";
import { createOpencodeBackendFromAppState } from "../ai/backends/opencodeBackendFactory";
import {
  type OpencodeFileChangeStatus,
  type OpencodeFileStatusEntry,
} from "../ai/backends/workspaceAgentBackend";
import { mapWorkingTreeStatusToAbsoluteBadges } from "../git/projectTreeFileStatusMap";
import { shouldLoadProjectTreeGitBadges } from "../git/gitIntegrationGating";
import { queryWorkingTreeStatus, resolveRepoRoot } from "../git/gitService";
import {
  subscribeVersionControlMutations,
  type VersionControlMutationScope,
} from "../git/versionControlRefresh";

/**
 * M5-T3 — workspace file-change tracker for project-tree M/A/D badges.
 *
 * Git-backed workspaces read `git status --porcelain` (FIX-02). Non-git
 * workspaces fall back to OpenCode `file.status` when the session tab is
 * active. Status entries resolve to absolute paths via `resolveAbsoluteStatusMap`.
 */

export type FileStatusTrackerStatus = "idle" | "loading" | "loaded" | "error";

export interface FileStatusTrackerState {
  status: FileStatusTrackerStatus;
  /** Absolute workspace path → change status. */
  statusByPath: Map<string, OpencodeFileChangeStatus>;
  lastErrorMessage: string | null;
  loadedAt: string | null;
  /** Whether the latest snapshot came from system git or OpenCode. */
  source: "git" | "opencode" | null;
}

const emptyState: FileStatusTrackerState = {
  status: "idle",
  statusByPath: new Map(),
  lastErrorMessage: null,
  loadedAt: null,
  source: null,
};

const FILE_STATUS_DEBOUNCE_MS = 150;

interface FileStatusEntry {
  value: FileStatusTrackerState;
  readable: Readable<FileStatusTrackerState>;
  set: (value: FileStatusTrackerState) => void;
}

const cache = new Map<string, FileStatusEntry>();
const inflight = new Map<string, Promise<FileStatusTrackerState>>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let mutationHooksInstalled = false;

function copyEmptyState(): FileStatusTrackerState {
  return { ...emptyState, statusByPath: new Map() };
}

function getOrCreateEntry(workspaceRootPath: string): FileStatusEntry {
  const existing = cache.get(workspaceRootPath);
  if (existing) {
    return existing;
  }

  const value = copyEmptyState();
  const store: Writable<FileStatusTrackerState> = writable(value);
  const entry: FileStatusEntry = {
    value,
    readable: { subscribe: store.subscribe },
    set: store.set,
  };
  cache.set(workspaceRootPath, entry);
  return entry;
}

function setEntryState(workspaceRootPath: string, state: FileStatusTrackerState): void {
  const entry = getOrCreateEntry(workspaceRootPath);
  entry.value = state;
  entry.set(state);
}

function emitDiagnostic(input: {
  reason: string;
  workspaceRootPath: string;
  level?: "debug" | "warn";
  error?: unknown;
  source?: FileStatusTrackerState["source"];
}): void {
  void logDiagnostic({
    level: input.level ?? "debug",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "file status refresh",
    metadata: {
      kind: "projectTree.fileStatus.refresh",
      reason: input.reason,
      workspaceRootPath: input.workspaceRootPath,
      source: input.source,
      error: input.error ? formatGitErrorPrimaryMessage(input.error) : undefined,
    },
  });
}

function ensureMutationRefreshHooks(): void {
  if (mutationHooksInstalled) {
    return;
  }
  mutationHooksInstalled = true;
  subscribeVersionControlMutations((workspaceRootPath) => {
    scheduleDebouncedFileStatusRefresh(workspaceRootPath);
  });
}

export function scheduleDebouncedFileStatusRefresh(workspaceRootPath: string): void {
  ensureMutationRefreshHooks();
  const existing = debounceTimers.get(workspaceRootPath);
  if (existing) {
    clearTimeout(existing);
  }
  debounceTimers.set(
    workspaceRootPath,
    setTimeout(() => {
      debounceTimers.delete(workspaceRootPath);
      void refreshFileStatuses({ workspaceRootPath });
    }, FILE_STATUS_DEBOUNCE_MS),
  );
}

async function fetchGitFileStatuses(
  workspaceRootPath: string,
): Promise<FileStatusTrackerState | null> {
  const repoResult = await resolveRepoRoot(workspaceRootPath);
  if (!repoResult.ok) {
    return null;
  }

  const workingTreeStatus = await queryWorkingTreeStatus(repoResult.repoRoot);
  const statusByPath = mapWorkingTreeStatusToAbsoluteBadges(
    repoResult.repoRoot,
    workingTreeStatus,
  );

  return {
    status: "loaded",
    statusByPath,
    lastErrorMessage: null,
    loadedAt: new Date().toISOString(),
    source: "git",
  };
}

async function fetchOpencodeFileStatuses(
  workspaceRootPath: string,
): Promise<FileStatusTrackerState> {
  const backend = createOpencodeBackendFromAppState();
  if (!backend) {
    return copyEmptyState();
  }

  const entries = await backend.listFileStatuses({ workspaceRootPath });
  const statusByPath = resolveAbsoluteStatusMap(workspaceRootPath, entries);
  return {
    status: "loaded",
    statusByPath,
    lastErrorMessage: null,
    loadedAt: new Date().toISOString(),
    source: "opencode",
  };
}

async function fetchFileStatuses(input: {
  workspaceRootPath: string;
  allowOpencode?: boolean;
}): Promise<FileStatusTrackerState> {
  if (!shouldLoadProjectTreeGitBadges()) {
    if (input.allowOpencode === false) {
      return copyEmptyState();
    }
    return fetchOpencodeFileStatuses(input.workspaceRootPath);
  }

  const gitState = await fetchGitFileStatuses(input.workspaceRootPath);
  if (gitState) {
    return gitState;
  }

  if (input.allowOpencode === false) {
    return copyEmptyState();
  }

  return fetchOpencodeFileStatuses(input.workspaceRootPath);
}

export function getFileStatusTracker(workspaceRootPath: string): Readable<FileStatusTrackerState> {
  ensureMutationRefreshHooks();
  return getOrCreateEntry(workspaceRootPath).readable;
}

export function getFileStatusSnapshot(workspaceRootPath: string): FileStatusTrackerState {
  return getOrCreateEntry(workspaceRootPath).value;
}

export function resetFileStatusTrackerForTests(): void {
  cache.clear();
  inflight.clear();
  mutationHooksInstalled = false;
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}

export async function refreshFileStatuses(input: {
  workspaceRootPath: string;
  allowOpencode?: boolean;
}): Promise<FileStatusTrackerState> {
  ensureMutationRefreshHooks();
  const { workspaceRootPath } = input;
  const existing = inflight.get(workspaceRootPath);
  if (existing) {
    return existing;
  }

  setEntryState(workspaceRootPath, {
    ...getFileStatusSnapshot(workspaceRootPath),
    status: "loading",
  });

  const promise = (async (): Promise<FileStatusTrackerState> => {
    try {
      const state = await fetchFileStatuses(input);
      setEntryState(workspaceRootPath, state);
      emitDiagnostic({
        reason: "loaded",
        workspaceRootPath,
        source: state.source ?? undefined,
      });
      return state;
    } catch (error: unknown) {
      const message = formatGitErrorPrimaryMessage(error);
      const errorState: FileStatusTrackerState = {
        ...copyEmptyState(),
        status: "error",
        lastErrorMessage: message,
      };
      setEntryState(workspaceRootPath, errorState);
      emitDiagnostic({
        reason: "error",
        workspaceRootPath,
        level: "warn",
        error,
      });
      return errorState;
    } finally {
      inflight.delete(workspaceRootPath);
    }
  })();

  inflight.set(workspaceRootPath, promise);
  return promise;
}

export function clearFileStatusTracker(workspaceRootPath: string): void {
  cache.delete(workspaceRootPath);
  inflight.delete(workspaceRootPath);
  const timer = debounceTimers.get(workspaceRootPath);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(workspaceRootPath);
  }
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

export type { VersionControlMutationScope };
