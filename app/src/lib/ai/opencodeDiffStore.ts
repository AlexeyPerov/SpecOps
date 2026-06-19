import type { Readable } from "svelte/store";
import { type OpencodeSessionFileDiff } from "./backends/workspaceAgentBackend";
import { createReactiveResourceStore } from "./opencodeResourceStore";

/**
 * M5-T2 — per-session reactive diff store. Wraps `session.diff` with the same
 * cache + inflight pattern as `opencodeTodoStore`. The `DiffViewerPanel`
 * subscribes and re-renders on refresh.
 *
 * M7-T2: the store is parameterized by `messageId` (a scoped refresh only
 * returns that message's files), so the cache + inflight maps must be keyed by
 * it too. M10-T1: the skeleton now lives in `createReactiveResourceStore`.
 */

export type OpencodeDiffStoreStatus = "idle" | "loading" | "loaded" | "error";

export interface OpencodeDiffStoreState {
  status: OpencodeDiffStoreStatus;
  files: OpencodeSessionFileDiff[];
  lastErrorMessage: string | null;
  loadedAt: string | null;
}

const emptyState: OpencodeDiffStoreState = {
  status: "idle",
  files: [],
  lastErrorMessage: null,
  loadedAt: null,
};

interface DiffKey {
  workspaceRootPath: string;
  sessionId: string;
  /** `"all"` mirrors the backend's "no messageId → whole session" scope. */
  messageId: string;
}

const store = createReactiveResourceStore<OpencodeDiffStoreState, DiffKey>({
  diagnosticLabel: "session diff",
  diagnosticKind: "opencode.session.diff.refresh",
  reactive: true,
  keyOf: (key) => `${key.workspaceRootPath}|${key.sessionId}|${key.messageId}`,
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
    files: [],
    lastErrorMessage: message,
    loadedAt: null,
  }),
  async fetch(backend, key) {
    const files = await backend.listSessionDiffs({
      workspaceRootPath: key.workspaceRootPath,
      sessionId: key.sessionId,
      ...(key.messageId !== "all" ? { messageId: key.messageId } : {}),
    });
    return {
      status: "loaded",
      files,
      lastErrorMessage: null,
      loadedAt: new Date().toISOString(),
    };
  },
});

function toKey(
  workspaceRootPath: string,
  sessionId: string,
  messageId?: string,
): DiffKey {
  return { workspaceRootPath, sessionId, messageId: messageId ?? "all" };
}

export function getSessionDiffs(
  workspaceRootPath: string,
  sessionId: string,
  messageId?: string,
): Readable<OpencodeDiffStoreState> {
  return store.getReadable(toKey(workspaceRootPath, sessionId, messageId));
}

export function getSessionDiffSnapshot(
  workspaceRootPath: string,
  sessionId: string,
  messageId?: string,
): OpencodeDiffStoreState {
  return store.getSnapshot(toKey(workspaceRootPath, sessionId, messageId));
}

export function resetSessionDiffStoreForTests(): void {
  store.resetForTests();
}

export async function refreshSessionDiffs(input: {
  workspaceRootPath: string;
  sessionId: string;
  messageId?: string;
}): Promise<OpencodeDiffStoreState> {
  return store.refresh(toKey(input.workspaceRootPath, input.sessionId, input.messageId));
}

export function clearSessionDiffs(
  workspaceRootPath: string,
  sessionId: string,
  messageId?: string,
): void {
  store.clear(toKey(workspaceRootPath, sessionId, messageId));
}
