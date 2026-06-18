import { writable, type Readable, type Writable } from "svelte/store";
import {
  createWorkspaceAgentBackend,
  type OpencodeTodoEntry,
  type OpencodeTodoPriority,
  type OpencodeTodoStatus,
} from "./backends/workspaceAgentBackend";
import { logDiagnostic } from "../services/logging";
import { appState } from "../state/appState";
import type { OpencodeTransportMode } from "../domain/contracts";
import { isOpencodeEnabled } from "../services/opencodeSettings";

/**
 * M5-T1 — per-session reactive TODO store. Wraps `session.todo` with a small
 * cache keyed by `${workspaceRoot}|${sessionId}`. Each entry is a Svelte
 * `Readable` so the `TodoPanel` re-renders on refresh without a manual poll.
 *
 * Auto-refresh is driven by the caller: `refreshSessionTodos` is invoked on
 * load and on every `tool.completed` event whose tool name is `todowrite`
 * (see `AppShell` wiring). Manual refresh is also exposed for the panel
 * header button.
 */

export type OpencodeTodoStoreStatus = "idle" | "loading" | "loaded" | "error";

export interface OpencodeTodoStoreState {
  status: OpencodeTodoStoreStatus;
  todos: OpencodeTodoEntry[];
  lastErrorMessage: string | null;
  loadedAt: string | null;
}

const emptyState: OpencodeTodoStoreState = {
  status: "idle",
  todos: [],
  lastErrorMessage: null,
  loadedAt: null,
};

function stateKey(workspaceRootPath: string, sessionId: string): string {
  return `${workspaceRootPath}|${sessionId}`;
}

interface CachedStore {
  readable: Readable<OpencodeTodoStoreState>;
  set: (value: OpencodeTodoStoreState) => void;
  value: OpencodeTodoStoreState;
}

const storeCache = new Map<string, CachedStore>();
const inflightRequests = new Map<string, Promise<OpencodeTodoStoreState>>();

function getOrCreateStore(
  workspaceRootPath: string,
  sessionId: string,
): CachedStore {
  const key = stateKey(workspaceRootPath, sessionId);
  const existing = storeCache.get(key);
  if (existing) {
    return existing;
  }
  const store: Writable<OpencodeTodoStoreState> = writable<OpencodeTodoStoreState>(emptyState);
  const cached: CachedStore = {
    readable: { subscribe: store.subscribe },
    set: store.set,
    value: emptyState,
  };
  storeCache.set(key, cached);
  return cached;
}

function setState(
  workspaceRootPath: string,
  sessionId: string,
  next: OpencodeTodoStoreState,
): void {
  const cached = getOrCreateStore(workspaceRootPath, sessionId);
  cached.value = next;
  cached.set(next);
}

/** Public accessor — returns the reactive store for a session (creates on first call). */
export function getSessionTodos(
  workspaceRootPath: string,
  sessionId: string,
): Readable<OpencodeTodoStoreState> {
  return getOrCreateStore(workspaceRootPath, sessionId).readable;
}

/** Returns a snapshot (non-reactive) of the current todos for a session. */
export function getSessionTodoSnapshot(
  workspaceRootPath: string,
  sessionId: string,
): OpencodeTodoStoreState {
  return getOrCreateStore(workspaceRootPath, sessionId).value;
}

export function resetSessionTodoStoreForTests(): void {
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
  sessionId: string;
  level?: "debug" | "warn";
  error?: unknown;
}): void {
  void logDiagnostic({
    level: input.level ?? "debug",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "session todo refresh",
    metadata: {
      kind: "opencode.session.todo.refresh",
      reason: input.reason,
      workspaceRootPath: input.workspaceRootPath,
      sessionId: input.sessionId,
      error: input.error instanceof Error ? input.error.message : undefined,
    },
  });
}

/**
 * Fetches `session.todo` for a session and updates the reactive store. Safe
 * to call repeatedly; concurrent calls for the same session share one inflight
 * request. Degrades to `error` state (never throws) so the panel always has
 * a renderable state.
 */
export async function refreshSessionTodos(input: {
  workspaceRootPath: string;
  sessionId: string;
}): Promise<OpencodeTodoStoreState> {
  const { workspaceRootPath, sessionId } = input;
  const key = stateKey(workspaceRootPath, sessionId);
  getOrCreateStore(workspaceRootPath, sessionId);

  const existing = inflightRequests.get(key);
  if (existing) {
    return existing;
  }

  const snapshot = appState.getSnapshot();
  if (!isOpencodeEnabled(snapshot.settings.opencode)) {
    const next: OpencodeTodoStoreState = { ...emptyState };
    setState(workspaceRootPath, sessionId, next);
    return next;
  }

  setState(workspaceRootPath, sessionId, {
    ...getSessionTodoSnapshot(workspaceRootPath, sessionId),
    status: "loading",
  });

  const promise = (async (): Promise<OpencodeTodoStoreState> => {
    try {
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async (): Promise<{
          mode: OpencodeTransportMode;
          baseUrl: string;
        }> => resolveRuntimeConfig(),
      });
      const todos = await backend.listSessionTodos({
        workspaceRootPath,
        sessionId,
      });
      const next: OpencodeTodoStoreState = {
        status: "loaded",
        todos,
        lastErrorMessage: null,
        loadedAt: new Date().toISOString(),
      };
      setState(workspaceRootPath, sessionId, next);
      emitDiagnostic({ reason: "loaded", workspaceRootPath, sessionId });
      return next;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load session todos.";
      const next: OpencodeTodoStoreState = {
        status: "error",
        todos: [],
        lastErrorMessage: message,
        loadedAt: null,
      };
      setState(workspaceRootPath, sessionId, next);
      emitDiagnostic({
        reason: "error",
        workspaceRootPath,
        sessionId,
        level: "warn",
        error,
      });
      return next;
    } finally {
      inflightRequests.delete(key);
    }
  })();

  inflightRequests.set(key, promise);
  return promise;
}

/** Drops the cached store for a session (e.g. when its agent tab closes). */
export function clearSessionTodos(workspaceRootPath: string, sessionId: string): void {
  const key = stateKey(workspaceRootPath, sessionId);
  storeCache.delete(key);
  inflightRequests.delete(key);
}

// -- Pure helpers (exposed for tests + the panel) -----------------------------

/** Stable ordering: in_progress → pending → completed → cancelled, then priority. */
const STATUS_RANK: Record<OpencodeTodoStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  cancelled: 3,
};

const PRIORITY_RANK: Record<OpencodeTodoPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function sortSessionTodos(todos: readonly OpencodeTodoEntry[]): OpencodeTodoEntry[] {
  return [...todos].sort((a, b) => {
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (byStatus !== 0) {
      return byStatus;
    }
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  });
}

export interface SessionTodoProgress {
  completed: number;
  total: number;
  /** 0–1 fraction completed (0 when total is 0). */
  fraction: number;
}

export function summarizeTodoProgress(
  todos: readonly OpencodeTodoEntry[],
): SessionTodoProgress {
  const total = todos.length;
  const completed = todos.filter((todo) => todo.status === "completed").length;
  return {
    completed,
    total,
    fraction: total === 0 ? 0 : completed / total,
  };
}

/** Re-exported so the panel imports status/priority lists from one place. */
export const TODO_STATUSES: readonly OpencodeTodoStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
];

export const TODO_PRIORITIES: readonly OpencodeTodoPriority[] = ["high", "medium", "low"];
