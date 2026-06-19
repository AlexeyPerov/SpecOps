import { writable, type Readable, type Writable } from "svelte/store";
import {
  createWorkspaceAgentBackend,
  type OpencodeSessionFileDiff,
} from "./backends/workspaceAgentBackend";
import { logDiagnostic } from "../services/logging";
import { appState } from "../state/appState";
import type { OpencodeTransportMode } from "../domain/contracts";
import { isOpencodeEnabled } from "../services/opencodeSettings";

/**
 * M5-T2 — per-session reactive diff store. Wraps `session.diff` with the same
 * cache + inflight pattern as `opencodeTodoStore`. The `DiffViewerPanel`
 * subscribes and re-renders on refresh.
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

function stateKey(workspaceRootPath: string, sessionId: string, messageId?: string): string {
  // M7-T2: the store is parameterized by `messageId` (a scoped refresh only
  // returns that message's files), so the cache + inflight maps must be keyed
  // by it too — otherwise a scoped refresh racing/caching against another
  // scope returns the wrong message's files. `"all"` mirrors the backend's
  // "no messageId → whole session" scope.
  return `${workspaceRootPath}|${sessionId}|${messageId ?? "all"}`;
}

interface CachedStore {
  readable: Readable<OpencodeDiffStoreState>;
  set: (value: OpencodeDiffStoreState) => void;
  value: OpencodeDiffStoreState;
}

const storeCache = new Map<string, CachedStore>();
const inflightRequests = new Map<string, Promise<OpencodeDiffStoreState>>();

function getOrCreateStore(
  workspaceRootPath: string,
  sessionId: string,
  messageId?: string,
): CachedStore {
  const key = stateKey(workspaceRootPath, sessionId, messageId);
  const existing = storeCache.get(key);
  if (existing) {
    return existing;
  }
  const store: Writable<OpencodeDiffStoreState> = writable<OpencodeDiffStoreState>(emptyState);
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
  next: OpencodeDiffStoreState,
  messageId?: string,
): void {
  const cached = getOrCreateStore(workspaceRootPath, sessionId, messageId);
  cached.value = next;
  cached.set(next);
}

export function getSessionDiffs(
  workspaceRootPath: string,
  sessionId: string,
  messageId?: string,
): Readable<OpencodeDiffStoreState> {
  return getOrCreateStore(workspaceRootPath, sessionId, messageId).readable;
}

export function getSessionDiffSnapshot(
  workspaceRootPath: string,
  sessionId: string,
  messageId?: string,
): OpencodeDiffStoreState {
  return getOrCreateStore(workspaceRootPath, sessionId, messageId).value;
}

export function resetSessionDiffStoreForTests(): void {
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
    message: "session diff refresh",
    metadata: {
      kind: "opencode.session.diff.refresh",
      reason: input.reason,
      workspaceRootPath: input.workspaceRootPath,
      sessionId: input.sessionId,
      error: input.error instanceof Error ? input.error.message : undefined,
    },
  });
}

export async function refreshSessionDiffs(input: {
  workspaceRootPath: string;
  sessionId: string;
  messageId?: string;
}): Promise<OpencodeDiffStoreState> {
  const { workspaceRootPath, sessionId, messageId } = input;
  const key = stateKey(workspaceRootPath, sessionId, messageId);
  getOrCreateStore(workspaceRootPath, sessionId, messageId);

  const existing = inflightRequests.get(key);
  if (existing) {
    return existing;
  }

  const snapshot = appState.getSnapshot();
  if (!isOpencodeEnabled(snapshot.settings.opencode)) {
    const next: OpencodeDiffStoreState = { ...emptyState };
    setState(workspaceRootPath, sessionId, next, messageId);
    return next;
  }

  setState(
    workspaceRootPath,
    sessionId,
    {
      ...getSessionDiffSnapshot(workspaceRootPath, sessionId, messageId),
      status: "loading",
    },
    messageId,
  );

  const promise = (async (): Promise<OpencodeDiffStoreState> => {
    try {
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async (): Promise<{
          mode: OpencodeTransportMode;
          baseUrl: string;
        }> => resolveRuntimeConfig(),
      });
      const files = await backend.listSessionDiffs({
        workspaceRootPath,
        sessionId,
        ...(messageId ? { messageId } : {}),
      });
      const next: OpencodeDiffStoreState = {
        status: "loaded",
        files,
        lastErrorMessage: null,
        loadedAt: new Date().toISOString(),
      };
      setState(workspaceRootPath, sessionId, next, messageId);
      emitDiagnostic({ reason: "loaded", workspaceRootPath, sessionId });
      return next;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load session diff.";
      const next: OpencodeDiffStoreState = {
        status: "error",
        files: [],
        lastErrorMessage: message,
        loadedAt: null,
      };
      setState(workspaceRootPath, sessionId, next, messageId);
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

export function clearSessionDiffs(
  workspaceRootPath: string,
  sessionId: string,
  messageId?: string,
): void {
  const key = stateKey(workspaceRootPath, sessionId, messageId);
  storeCache.delete(key);
  inflightRequests.delete(key);
}
