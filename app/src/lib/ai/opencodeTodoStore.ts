import type { Readable } from "svelte/store";
import {
  type OpencodeTodoEntry,
  type OpencodeTodoPriority,
  type OpencodeTodoStatus,
} from "./backends/workspaceAgentBackend";
import { createReactiveResourceStore } from "./opencodeResourceStore";

/**
 * M5-T1 — per-session reactive TODO store. Wraps `session.todo` with a small
 * cache keyed by `${workspaceRoot}|${sessionId}`. Each entry is a Svelte
 * `Readable` so the `TodoPanel` re-renders on refresh without a manual poll.
 *
 * Auto-refresh is driven by the caller: `refreshSessionTodos` is invoked on
 * load and on every `tool.completed` event whose tool name is `todowrite`
 * (see `AppShell` wiring). Manual refresh is also exposed for the panel
 * header button.
 *
 * M10-T1: the cache + inflight + diagnostic + never-throws skeleton now lives
 * in the shared `createReactiveResourceStore` factory; only the per-session
 * key shape and the `session.todo` fetch are store-specific.
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

interface TodoKey {
  workspaceRootPath: string;
  sessionId: string;
}

const store = createReactiveResourceStore<OpencodeTodoStoreState, TodoKey>({
  diagnosticLabel: "session todo",
  diagnosticKind: "opencode.session.todo.refresh",
  reactive: true,
  keyOf: (key) => `${key.workspaceRootPath}|${key.sessionId}`,
  diagnosticExtra: (key) => ({
    workspaceRootPath: key.workspaceRootPath,
    sessionId: key.sessionId,
  }),
  copyEmptyState: () => ({ ...emptyState }),
  disabledState: () => ({ ...emptyState }),
  buildLoadingState: (prior) => ({ ...prior, status: "loading" }),
  buildErrorState: (message) => ({
    ...emptyState,
    status: "error",
    todos: [],
    lastErrorMessage: message,
    loadedAt: null,
  }),
  async fetch(backend, key) {
    const todos = await backend.listSessionTodos({
      workspaceRootPath: key.workspaceRootPath,
      sessionId: key.sessionId,
    });
    return {
      status: "loaded",
      todos,
      lastErrorMessage: null,
      loadedAt: new Date().toISOString(),
    };
  },
});

/** Public accessor — returns the reactive store for a session (creates on first call). */
export function getSessionTodos(
  workspaceRootPath: string,
  sessionId: string,
): Readable<OpencodeTodoStoreState> {
  return store.getReadable({ workspaceRootPath, sessionId });
}

/** Returns a snapshot (non-reactive) of the current todos for a session. */
export function getSessionTodoSnapshot(
  workspaceRootPath: string,
  sessionId: string,
): OpencodeTodoStoreState {
  return store.getSnapshot({ workspaceRootPath, sessionId });
}

export function resetSessionTodoStoreForTests(): void {
  store.resetForTests();
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
  return store.refresh(input);
}

/** Drops the cached store for a session (e.g. when its agent tab closes). */
export function clearSessionTodos(workspaceRootPath: string, sessionId: string): void {
  store.clear({ workspaceRootPath, sessionId });
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
