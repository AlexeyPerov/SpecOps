import type { ChatThreadSnapshot, SessionIndexEntry } from "../../domain/contracts";
import { draftEntryTitleForScope, deriveSessionTitle } from "../../services/chatSessions";
import {
  deleteSessionPersistence,
  readSessionThreadFileSnapshot,
  readWorkspaceSessionsIndexSnapshot,
} from "../../services/chatPersistence";
import { mapWithConcurrency } from "../../services/mapWithConcurrency";
import { elapsedMs, logPerfTiming, nowMs } from "../../services/perfDiagnostics";
import type { ChatStoreState, WorkspaceSessionsState } from "./types";
import {
  getOrCreateWorkspaceState,
  patchWorkspaceState,
  activeSessionId,
} from "./workspace";
import { normalizeThreadSnapshotForScope } from "../../ai/providers/threadScopeNormalization";
import { cloneThread } from "./threadHelpers";

/** Max concurrent thread-file reads during workspace session hydration. */
export const SESSION_THREAD_HYDRATE_CONCURRENCY = 6;

let sessionIdCounter = 0;

/** Generation token so background hydrates abort after a newer load for the same scope. */
const hydrateGenerationByScope = new Map<string, number>();
/** In-flight ensure/hydrate promises keyed by `scopeKey\\0sessionId`. */
const inFlightThreadHydrates = new Map<string, Promise<ChatThreadSnapshot | null>>();

/**
 * Per-scope signature of the last persisted index that was fully loaded into
 * memory. When the on-disk index signature matches this AND every non-draft
 * persisted session already has a thread entry in `threadsBySessionId`, the
 * loader skips re-reading thread files from disk — workspace switches no longer
 * re-walk every session thread when the cache is current.
 */
const loadedIndexSignatureByScope = new Map<string, string>();

function threadHydrateKey(scopeKey: string, sessionId: string): string {
  return `${scopeKey}\x00${sessionId}`;
}

function bumpHydrateGeneration(scopeKey: string): number {
  const next = (hydrateGenerationByScope.get(scopeKey) ?? 0) + 1;
  hydrateGenerationByScope.set(scopeKey, next);
  return next;
}

function isHydrateGenerationCurrent(scopeKey: string, generation: number): boolean {
  return hydrateGenerationByScope.get(scopeKey) === generation;
}

/**
 * Stable signature for a persisted sessions index. Used to detect that the
 * on-disk index has not changed since the last full load, which (combined with
 * the in-memory thread map being complete) lets the loader skip re-reading
 * every session thread file on workspace re-entry.
 *
 * Includes `id`, `lastUsedAt`, and `title` because those are the fields a
 * background write or external edit can change without the app's involvement.
 */
function indexSignature(sessions: readonly SessionIndexEntry[]): string {
  return sessions
    .map((entry) => `${entry.id}|${entry.lastUsedAt}|${entry.title ?? ""}`)
    .join("\n");
}

/** Clears incremental-hydration bookkeeping between unit tests. */
export function resetSessionHydrationForTests(): void {
  hydrateGenerationByScope.clear();
  inFlightThreadHydrates.clear();
  loadedIndexSignatureByScope.clear();
}

export interface LoadWorkspaceSessionsOptions {
  /**
   * Session ids that must be thread-hydrated before `loadWorkspaceSessions` resolves
   * (active / open / visible tabs). Remaining persisted sessions hydrate in background.
   */
  prioritySessionIds?: readonly string[];
}

function parseSessionCounterFromId(sessionId: string): number | null {
  const match = /^session-(\d+)$/.exec(sessionId);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Clears session id counter between unit tests. */
export function resetSessionIdCounterForTests(): void {
  sessionIdCounter = 0;
}

export function createSessionId(): string {
  sessionIdCounter += 1;
  return `session-${sessionIdCounter}`;
}

export function createDraftSessionEntry(
  sessionId: string,
  lastUsedAt: string,
  scopeKey?: string | null,
): SessionIndexEntry {
  return {
    id: sessionId,
    title: draftEntryTitleForScope(scopeKey),
    lastUsedAt,
    isDraft: true,
  };
}

export function findSessionIndexEntry(
  workspace: WorkspaceSessionsState,
  sessionId: string,
): SessionIndexEntry | undefined {
  return workspace.sessionIndex.find((entry) => entry.id === sessionId);
}

export function isDraftSessionEntry(entry: SessionIndexEntry | undefined): boolean {
  return entry?.isDraft === true;
}

export function promoteDraftSessionIndexEntry(
  entry: SessionIndexEntry,
  firstUserMessageContent: string,
  lastUsedAt: string,
): SessionIndexEntry {
  return {
    id: entry.id,
    title: deriveSessionTitle({ firstUserMessage: firstUserMessageContent }),
    lastUsedAt,
  };
}

export function patchSessionIndexEntry(
  sessionIndex: SessionIndexEntry[],
  sessionId: string,
  nextEntry: SessionIndexEntry,
): SessionIndexEntry[] {
  return sessionIndex.map((entry) => (entry.id === sessionId ? nextEntry : entry));
}

export interface SessionLinkPatch {
  opencodeSessionId?: string;
  opencodeModelId?: string;
  opencodeProviderId?: string;
  opencodeShareUrl?: string;
  opencodeParentSessionId?: string;
}

function applySessionLinkPatch(
  entry: SessionIndexEntry,
  patch: SessionLinkPatch,
): SessionIndexEntry {
  const next: SessionIndexEntry = {
    ...entry,
    ...patch,
  };
  if (!next.opencodeSessionId) {
    delete next.opencodeSessionId;
    delete next.opencodeModelId;
    delete next.opencodeProviderId;
    delete next.opencodeShareUrl;
    delete next.opencodeParentSessionId;
    return next;
  }
  if (!next.opencodeModelId) {
    delete next.opencodeModelId;
  }
  if (!next.opencodeProviderId) {
    delete next.opencodeProviderId;
  }
  if (!next.opencodeShareUrl) {
    delete next.opencodeShareUrl;
  }
  if (!next.opencodeParentSessionId) {
    delete next.opencodeParentSessionId;
  }
  return next;
}

function didSessionLinkChange(entry: SessionIndexEntry, patch: SessionLinkPatch): boolean {
  const next = applySessionLinkPatch(entry, patch);
  return (
    next.opencodeSessionId !== entry.opencodeSessionId ||
    next.opencodeModelId !== entry.opencodeModelId ||
    next.opencodeProviderId !== entry.opencodeProviderId ||
    next.opencodeShareUrl !== entry.opencodeShareUrl ||
    next.opencodeParentSessionId !== entry.opencodeParentSessionId
  );
}

export function resolveTargetSessionId(state: ChatStoreState, sessionId?: string): string | null {
  if (sessionId) {
    return sessionId;
  }
  return activeSessionId(state);
}

export function ensureActiveSession(
  state: ChatStoreState,
): { state: ChatStoreState; workspace: WorkspaceSessionsState; sessionId: string } | null {
  const root = state.activeChatScopeKey;
  if (!root) {
    return null;
  }

  const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
  if (workspace.activeSessionId) {
    return { state: nextState, workspace, sessionId: workspace.activeSessionId };
  }

  const sessionId = createSessionId();
  const lastUsedAt = new Date().toISOString();
  const nextWorkspace: WorkspaceSessionsState = {
    ...workspace,
    activeSessionId: sessionId,
    sessionIndex: [...workspace.sessionIndex, createDraftSessionEntry(sessionId, lastUsedAt, root)],
  };

  return {
    state: patchWorkspaceState(nextState, root, nextWorkspace),
    workspace: nextWorkspace,
    sessionId,
  };
}

type ChatStoreUpdate = (mutator: (state: ChatStoreState) => ChatStoreState) => void;

export function createSessionsSlice(deps: {
  update: ChatStoreUpdate;
  getSnapshot: () => ChatStoreState;
  getActiveChatScopeKey: () => string | null;
}) {
  const { update, getSnapshot, getActiveChatScopeKey } = deps;

  function normalizeThreadForScope(
    scopeKey: string,
    thread: import("../../domain/contracts").ChatThreadSnapshot | null,
  ): import("../../domain/contracts").ChatThreadSnapshot | null {
    return normalizeThreadSnapshotForScope(thread, scopeKey);
  }

  function syncSessionIdCounterFromWorkspace(workspace: WorkspaceSessionsState): void {
    let maxCounter = sessionIdCounter;
    for (const entry of workspace.sessionIndex) {
      const parsed = parseSessionCounterFromId(entry.id);
      if (parsed !== null && parsed > maxCounter) {
        maxCounter = parsed;
      }
    }
    sessionIdCounter = maxCounter;
  }

  return {
    getActiveSessionId(): string | null {
      return activeSessionId(getSnapshot());
    },
    setActiveSessionId(sessionId: string | null): void {
      update((state) => {
        const root = state.activeChatScopeKey;
        if (!root) {
          return state;
        }
        const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
        if (workspace.activeSessionId === sessionId) {
          return nextState;
        }
        return patchWorkspaceState(nextState, root, {
          ...workspace,
          activeSessionId: sessionId,
        });
      });
    },
    createDraftSession(options?: { activate?: boolean }): string | null {
      const root = getActiveChatScopeKey();
      if (!root) {
        return null;
      }

      let createdSessionId: string | null = null;
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
        const sessionId = createSessionId();
        const lastUsedAt = new Date().toISOString();
        const activate = options?.activate !== false;
        createdSessionId = sessionId;
        return patchWorkspaceState(nextState, root, {
          ...workspace,
          activeSessionId: activate ? sessionId : workspace.activeSessionId,
          sessionIndex: [...workspace.sessionIndex, createDraftSessionEntry(sessionId, lastUsedAt, root)],
        });
      });
      return createdSessionId;
    },
    isSessionDraft(sessionId: string): boolean {
      const root = getActiveChatScopeKey();
      if (!root) {
        return false;
      }
      const workspace = getSnapshot().workspaces[root];
      if (!workspace) {
        return false;
      }
      return isDraftSessionEntry(findSessionIndexEntry(workspace, sessionId));
    },
    getSessionTitle(sessionId: string): string | null {
      const root = getActiveChatScopeKey();
      if (!root) {
        return null;
      }
      const workspace = getSnapshot().workspaces[root];
      if (!workspace) {
        return null;
      }
      return findSessionIndexEntry(workspace, sessionId)?.title ?? null;
    },
    getSessionIndex(): SessionIndexEntry[] {
      const root = getActiveChatScopeKey();
      if (!root) {
        return [];
      }
      return [...(getSnapshot().workspaces[root]?.sessionIndex ?? [])];
    },
    getSessionLink(
      sessionId: string,
      rootOverride?: string | null,
    ): SessionLinkPatch | null {
      const root = rootOverride ?? getActiveChatScopeKey();
      if (!root) {
        return null;
      }
      const workspace = getSnapshot().workspaces[root];
      if (!workspace) {
        return null;
      }
      const entry = findSessionIndexEntry(workspace, sessionId);
      if (!entry || !entry.opencodeSessionId) {
        return null;
      }
      return {
        opencodeSessionId: entry.opencodeSessionId,
        opencodeModelId: entry.opencodeModelId,
        opencodeProviderId: entry.opencodeProviderId,
        opencodeShareUrl: entry.opencodeShareUrl,
        opencodeParentSessionId: entry.opencodeParentSessionId,
      };
    },
    setSessionLink(
      sessionId: string,
      patch: SessionLinkPatch,
      rootOverride?: string | null,
    ): boolean {
      const root = rootOverride ?? getActiveChatScopeKey();
      if (!root) {
        return false;
      }
      let changed = false;
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
        const entry = findSessionIndexEntry(workspace, sessionId);
        if (!entry) {
          return nextState;
        }
        if (!didSessionLinkChange(entry, patch)) {
          return nextState;
        }
        changed = true;
        return patchWorkspaceState(nextState, root, {
          ...workspace,
          sessionIndex: patchSessionIndexEntry(
            workspace.sessionIndex,
            sessionId,
            applySessionLinkPatch(entry, patch),
          ),
        });
      });
      return changed;
    },
    clearSessionLink(sessionId: string, rootOverride?: string | null): boolean {
      return this.setSessionLink(
        sessionId,
        {
          opencodeSessionId: "",
          opencodeModelId: "",
          opencodeProviderId: "",
          opencodeShareUrl: "",
          opencodeParentSessionId: "",
        },
        rootOverride,
      );
    },
    /**
     * Rename a session tab (M2-T1). Updates `title` and bumps `lastUsedAt` so
     * the row re-sorts to the top of the sidebar. Returns false when the
     * session isn't found or the trimmed title is empty. Does NOT call OpenCode
     * — the caller (handler) is responsible for `session.update({ title })`
     * and only invokes this once that succeeds.
     */
    renameSession(sessionId: string, title: string, rootOverride?: string | null): boolean {
      const root = rootOverride ?? getActiveChatScopeKey();
      if (!root) {
        return false;
      }
      const trimmed = title.trim();
      if (trimmed.length === 0) {
        return false;
      }
      let renamed = false;
      update((state) => {
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const entry = findSessionIndexEntry(workspace, sessionId);
        if (!entry) {
          return state;
        }
        if (entry.title === trimmed) {
          renamed = true;
          return state;
        }
        renamed = true;
        const nextEntry: SessionIndexEntry = {
          ...entry,
          title: trimmed,
          lastUsedAt: new Date().toISOString(),
        };
        return patchWorkspaceState(state, root, {
          ...workspace,
          sessionIndex: patchSessionIndexEntry(workspace.sessionIndex, sessionId, nextEntry),
        });
      });
      return renamed;
    },
    /**
     * Create a fresh session tab linked to a (just-forked) OpenCode session
     * (M2-T3). The new entry is non-draft and active so the UI opens it. The
     * caller (handler) is responsible for calling `session.fork` first and
     * passing the child session id + parent id here. Returns the new session id.
     *
     * `modelId` / `providerId` are inherited from the parent entry when not
     * supplied, so the forked tab keeps the same model selection.
     */
    forkSession(
      link: {
        opencodeSessionId: string;
        opencodeParentSessionId: string;
        title?: string;
        opencodeModelId?: string;
        opencodeProviderId?: string;
      },
      rootOverride?: string | null,
    ): string | null {
      const root = rootOverride ?? getActiveChatScopeKey();
      if (!root) {
        return null;
      }
      const workspace = getSnapshot().workspaces[root];
      if (!workspace) {
        return null;
      }
      const parentEntry = workspace.sessionIndex.find(
        (entry) => entry.opencodeSessionId === link.opencodeParentSessionId,
      );
      const modelId = link.opencodeModelId ?? parentEntry?.opencodeModelId;
      const providerId = link.opencodeProviderId ?? parentEntry?.opencodeProviderId;
      const title =
        link.title?.trim() ||
        (parentEntry ? `${parentEntry.title} (fork)` : "Forked session");
      const sessionId = createSessionId();
      const lastUsedAt = new Date().toISOString();
      const entry: SessionIndexEntry = {
        id: sessionId,
        title,
        lastUsedAt,
        opencodeSessionId: link.opencodeSessionId,
        opencodeParentSessionId: link.opencodeParentSessionId,
        ...(modelId ? { opencodeModelId: modelId } : {}),
        ...(providerId ? { opencodeProviderId: providerId } : {}),
      };
      update((state) => {
        const ws = state.workspaces[root];
        if (!ws) {
          return state;
        }
        return patchWorkspaceState(state, root, {
          ...ws,
          activeSessionId: sessionId,
          sessionIndex: [...ws.sessionIndex, entry],
        });
      });
      return sessionId;
    },
    getWorkspaceSessionsState(root: string): WorkspaceSessionsState | null {
      const workspace = getSnapshot().workspaces[root];
      if (!workspace) {
        return null;
      }
      return {
        activeSessionId: workspace.activeSessionId,
        sessionIndex: [...workspace.sessionIndex],
        threadsBySessionId: { ...workspace.threadsBySessionId },
        runtimeBySessionId: { ...workspace.runtimeBySessionId },
      };
    },
    /**
     * True when a persisted session's thread file has been read into memory
     * (including a null/empty result). Drafts and missing index entries count as ready.
     */
    isSessionThreadHydrated(sessionId: string, rootOverride?: string | null): boolean {
      const root = rootOverride ?? getActiveChatScopeKey();
      if (!root) {
        return false;
      }
      const workspace = getSnapshot().workspaces[root];
      if (!workspace) {
        return false;
      }
      const entry = findSessionIndexEntry(workspace, sessionId);
      if (!entry) {
        return true;
      }
      if (entry.isDraft) {
        return true;
      }
      return Object.prototype.hasOwnProperty.call(workspace.threadsBySessionId, sessionId);
    },
    /**
     * Ensure a session thread is loaded from disk. No-op when already hydrated or draft.
     * Used when selecting a session whose thread was deferred during incremental load.
     */
    async ensureSessionThreadHydrated(
      sessionId: string,
      rootOverride?: string | null,
    ): Promise<ChatThreadSnapshot | null> {
      const root = rootOverride ?? getActiveChatScopeKey();
      if (!root) {
        return null;
      }
      if (this.isSessionThreadHydrated(sessionId, root)) {
        return cloneThread(getSnapshot().workspaces[root]?.threadsBySessionId[sessionId] ?? null);
      }

      const key = threadHydrateKey(root, sessionId);
      let readPromise = inFlightThreadHydrates.get(key);
      if (!readPromise) {
        readPromise = readSessionThreadFileSnapshot(root, sessionId).then((raw) =>
          normalizeThreadForScope(root, cloneThread(raw)),
        );
        inFlightThreadHydrates.set(key, readPromise);
        void readPromise.finally(() => {
          if (inFlightThreadHydrates.get(key) === readPromise) {
            inFlightThreadHydrates.delete(key);
          }
        });
      }

      const thread = await readPromise;
      if (this.isSessionThreadHydrated(sessionId, root)) {
        return cloneThread(getSnapshot().workspaces[root]?.threadsBySessionId[sessionId] ?? null);
      }

      update((state) => {
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        if (Object.prototype.hasOwnProperty.call(workspace.threadsBySessionId, sessionId)) {
          return state;
        }
        if (!findSessionIndexEntry(workspace, sessionId)) {
          return state;
        }
        return patchWorkspaceState(state, root, {
          ...workspace,
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [sessionId]: thread,
          },
        });
      });
      return cloneThread(thread);
    },
    async loadWorkspaceSessions(
      normalizedRootPath: string,
      options?: LoadWorkspaceSessionsOptions,
    ): Promise<void> {
      const loadStartedAt = nowMs();
      const generation = bumpHydrateGeneration(normalizedRootPath);
      const indexStartedAt = nowMs();
      const index = await readWorkspaceSessionsIndexSnapshot(normalizedRootPath);
      const indexDurationMs = elapsedMs(indexStartedAt);
      if (!isHydrateGenerationCurrent(normalizedRootPath, generation)) {
        return;
      }

      const persistedEntries = index.sessions.filter((entry) => !entry.isDraft);
      // Omit `prioritySessionIds` → hydrate all before resolve (compat + concurrency).
      // Provide the option (even `[]`) → hydrate only those first; defer the rest.
      const prioritySessionIds = options?.prioritySessionIds;
      const incremental = prioritySessionIds !== undefined;
      const priorityIdSet = incremental
        ? new Set(prioritySessionIds.filter((id) => id.length > 0))
        : null;

      // Skip re-reading thread files when the on-disk index matches what we
      // last loaded AND every persisted session already has a thread entry in
      // memory. This is the common path on a re-entry to a workspace whose
      // sessions are already cached: instead of re-walking every thread file,
      // we just refresh the session index and merge drafts.
      const incomingSignature = indexSignature(persistedEntries);
      const existingWorkspace = getSnapshot().workspaces[normalizedRootPath];
      const existingThreads = existingWorkspace?.threadsBySessionId ?? {};
      const allPersistedHydrated =
        existingWorkspace !== undefined &&
        loadedIndexSignatureByScope.get(normalizedRootPath) === incomingSignature &&
        persistedEntries.length > 0 &&
        persistedEntries.every((entry) =>
          Object.prototype.hasOwnProperty.call(existingThreads, entry.id),
        );

      if (allPersistedHydrated) {
        update((state) => {
          const existing = state.workspaces[normalizedRootPath];
          if (!existing) {
            return state;
          }
          const persistedIds = new Set(index.sessions.map((entry) => entry.id));
          const sessionDrafts = existing.sessionIndex.filter(
            (entry) => entry.isDraft && !persistedIds.has(entry.id),
          );
          const mergedIndex = [...index.sessions, ...sessionDrafts];
          syncSessionIdCounterFromWorkspace({
            ...existing,
            sessionIndex: mergedIndex,
          });
          return patchWorkspaceState(state, normalizedRootPath, {
            ...existing,
            sessionIndex: mergedIndex,
          });
        });

        void logPerfTiming("workspace sessions load complete", {
          metric: "workspace.sessionLoad",
          durationMs: elapsedMs(loadStartedAt),
          workspaceRoot: normalizedRootPath,
          sessionCount: index.sessions.length,
          hydratedThreadCount: 0,
          deferredThreadCount: 0,
          indexDurationMs,
          threadsDurationMs: 0,
          incremental,
          cacheHit: true,
        });
        return;
      }

      const priorityEntries = priorityIdSet
        ? persistedEntries.filter((entry) => priorityIdSet.has(entry.id))
        : persistedEntries;
      const deferredEntries = priorityIdSet
        ? persistedEntries.filter((entry) => !priorityIdSet.has(entry.id))
        : [];

      // Within the priority/deferred sets, skip sessions whose threads are
      // already in memory (same index, re-entry): only read the genuinely
      // missing ones.
      const needsRead = (entry: SessionIndexEntry): boolean =>
        !Object.prototype.hasOwnProperty.call(existingThreads, entry.id);
      const priorityToRead = priorityEntries.filter(needsRead);
      const deferredToRead = deferredEntries.filter(needsRead);

      const threadsStartedAt = nowMs();
      const priorityThreads = await mapWithConcurrency(
        priorityToRead,
        SESSION_THREAD_HYDRATE_CONCURRENCY,
        async (entry) => {
          const thread = normalizeThreadForScope(
            normalizedRootPath,
            cloneThread(await readSessionThreadFileSnapshot(normalizedRootPath, entry.id)),
          );
          return [entry.id, thread] as const;
        },
      );
      const priorityThreadsDurationMs = elapsedMs(threadsStartedAt);
      if (!isHydrateGenerationCurrent(normalizedRootPath, generation)) {
        return;
      }

      const priorityThreadsBySessionId: Record<string, ChatThreadSnapshot | null> = {};
      for (const [sessionId, thread] of priorityThreads) {
        priorityThreadsBySessionId[sessionId] = thread;
      }

      update((state) => {
        const existing = state.workspaces[normalizedRootPath];
        const persistedIds = new Set(index.sessions.map((entry) => entry.id));
        const sessionDrafts = (existing?.sessionIndex ?? []).filter(
          (entry) => entry.isDraft && !persistedIds.has(entry.id),
        );
        const mergedIndex = [...index.sessions, ...sessionDrafts];
        const mergedIds = new Set(mergedIndex.map((entry) => entry.id));
        const existingThreadsBySessionId = existing?.threadsBySessionId ?? {};
        const mergedThreadsBySessionId: Record<string, ChatThreadSnapshot | null> = {
          ...priorityThreadsBySessionId,
        };
        const mergedRuntimeBySessionId = { ...(existing?.runtimeBySessionId ?? {}) };
        // Carry over existing in-memory threads for persisted sessions that
        // were not re-read from disk this pass (they are still current — same
        // index signature or skipped because their thread was already loaded).
        for (const entry of persistedEntries) {
          if (Object.prototype.hasOwnProperty.call(mergedThreadsBySessionId, entry.id)) {
            continue;
          }
          if (Object.prototype.hasOwnProperty.call(existingThreadsBySessionId, entry.id)) {
            mergedThreadsBySessionId[entry.id] = existingThreadsBySessionId[entry.id];
          }
        }
        for (const draft of sessionDrafts) {
          if (existingThreadsBySessionId[draft.id]) {
            mergedThreadsBySessionId[draft.id] = existingThreadsBySessionId[draft.id];
          }
          if (existing?.runtimeBySessionId[draft.id]) {
            mergedRuntimeBySessionId[draft.id] = existing.runtimeBySessionId[draft.id];
          }
        }
        const activeSessionIdValue =
          existing?.activeSessionId && mergedIds.has(existing.activeSessionId)
            ? existing.activeSessionId
            : null;
        syncSessionIdCounterFromWorkspace({
          activeSessionId: activeSessionIdValue,
          sessionIndex: mergedIndex,
          threadsBySessionId: mergedThreadsBySessionId,
          runtimeBySessionId: mergedRuntimeBySessionId,
        });

        return {
          ...state,
          workspaces: {
            ...state.workspaces,
            [normalizedRootPath]: {
              activeSessionId: activeSessionIdValue,
              sessionIndex: mergedIndex,
              threadsBySessionId: mergedThreadsBySessionId,
              runtimeBySessionId: mergedRuntimeBySessionId,
            },
          },
        };
      });

      // Persisted sessions not yet covered by priority/deferred reads keep
      // their existing in-memory thread entries. We need to make sure those
      // are reflected when computing the "fully loaded" signature below, so
      // rebuild the in-memory thread map view including the carry-overs.
      const postUpdateWorkspace = getSnapshot().workspaces[normalizedRootPath];
      const postUpdateSignature =
        postUpdateWorkspace !== undefined &&
        deferredToRead.length === 0 &&
        persistedEntries.every((entry) =>
          Object.prototype.hasOwnProperty.call(
            postUpdateWorkspace.threadsBySessionId,
            entry.id,
          ),
        )
          ? incomingSignature
          : null;
      if (postUpdateSignature !== null) {
        loadedIndexSignatureByScope.set(normalizedRootPath, postUpdateSignature);
      } else {
        loadedIndexSignatureByScope.delete(normalizedRootPath);
      }

      void logPerfTiming("workspace sessions load complete", {
        metric: "workspace.sessionLoad",
        durationMs: elapsedMs(loadStartedAt),
        workspaceRoot: normalizedRootPath,
        sessionCount: index.sessions.length,
        hydratedThreadCount: priorityToRead.length,
        deferredThreadCount: deferredToRead.length,
        indexDurationMs,
        threadsDurationMs: priorityThreadsDurationMs,
        incremental,
      });

      if (deferredToRead.length === 0) {
        return;
      }

      void (async () => {
        const backgroundStartedAt = nowMs();
        const deferredThreads = await mapWithConcurrency(
          deferredToRead,
          SESSION_THREAD_HYDRATE_CONCURRENCY,
          async (entry) => {
            const key = threadHydrateKey(normalizedRootPath, entry.id);
            const inFlight = inFlightThreadHydrates.get(key);
            if (inFlight) {
              const thread = await inFlight;
              return [entry.id, thread] as const;
            }
            const promise = readSessionThreadFileSnapshot(normalizedRootPath, entry.id).then(
              (raw) => normalizeThreadForScope(normalizedRootPath, cloneThread(raw)),
            );
            inFlightThreadHydrates.set(key, promise);
            try {
              const thread = await promise;
              return [entry.id, thread] as const;
            } finally {
              if (inFlightThreadHydrates.get(key) === promise) {
                inFlightThreadHydrates.delete(key);
              }
            }
          },
        );
        if (!isHydrateGenerationCurrent(normalizedRootPath, generation)) {
          return;
        }

        update((state) => {
          const workspace = state.workspaces[normalizedRootPath];
          if (!workspace) {
            return state;
          }
          let changed = false;
          const nextThreads = { ...workspace.threadsBySessionId };
          for (const [sessionId, thread] of deferredThreads) {
            if (Object.prototype.hasOwnProperty.call(nextThreads, sessionId)) {
              continue;
            }
            if (!findSessionIndexEntry(workspace, sessionId)) {
              continue;
            }
            nextThreads[sessionId] = thread;
            changed = true;
          }
          if (!changed) {
            return state;
          }
          return patchWorkspaceState(state, normalizedRootPath, {
            ...workspace,
            threadsBySessionId: nextThreads,
          });
        });

        // After the background drain completes, mark the scope fully loaded if
        // every persisted session now has a thread entry.
        const afterBackgroundWorkspace = getSnapshot().workspaces[normalizedRootPath];
        if (
          afterBackgroundWorkspace !== undefined &&
          persistedEntries.every((entry) =>
            Object.prototype.hasOwnProperty.call(
              afterBackgroundWorkspace.threadsBySessionId,
              entry.id,
            ),
          )
        ) {
          loadedIndexSignatureByScope.set(normalizedRootPath, incomingSignature);
        }

        void logPerfTiming("workspace sessions background hydrate complete", {
          metric: "workspace.sessionLoad",
          durationMs: elapsedMs(backgroundStartedAt),
          workspaceRoot: normalizedRootPath,
          hydratedThreadCount: deferredToRead.length,
          deferredThreadCount: 0,
          background: true,
          incremental: true,
        });
      })();
    },
    mergeSessionDrafts(normalizedRootPath: string, sessionIds: readonly string[]): void {
      if (sessionIds.length === 0) {
        return;
      }
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, normalizedRootPath);
        const knownIds = new Set(workspace.sessionIndex.map((entry) => entry.id));
        const additions: SessionIndexEntry[] = [];
        const lastUsedAt = new Date().toISOString();
        for (const sessionId of sessionIds) {
          if (knownIds.has(sessionId)) {
            continue;
          }
          knownIds.add(sessionId);
          additions.push(createDraftSessionEntry(sessionId, lastUsedAt, normalizedRootPath));
        }
        if (additions.length === 0) {
          return nextState;
        }
        syncSessionIdCounterFromWorkspace({
          ...workspace,
          sessionIndex: [...workspace.sessionIndex, ...additions],
        });
        return patchWorkspaceState(nextState, normalizedRootPath, {
          ...workspace,
          sessionIndex: [...workspace.sessionIndex, ...additions],
        });
      });
    },
    /** @deprecated Use loadWorkspaceSessions. */
    async loadWorkspaceThread(normalizedRootPath: string): Promise<void> {
      await this.loadWorkspaceSessions(normalizedRootPath);
    },
    async deleteSession(sessionId: string): Promise<boolean> {
      const root = getActiveChatScopeKey();
      if (!root) {
        return false;
      }

      update((state) => {
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }

        const { [sessionId]: _removedThread, ...remainingThreads } = workspace.threadsBySessionId;
        const { [sessionId]: _removedRuntime, ...remainingRuntime } = workspace.runtimeBySessionId;
        const nextActiveSessionId =
          workspace.activeSessionId === sessionId ? null : workspace.activeSessionId;

        return patchWorkspaceState(state, root, {
          ...workspace,
          activeSessionId: nextActiveSessionId,
          sessionIndex: workspace.sessionIndex.filter((entry) => entry.id !== sessionId),
          threadsBySessionId: remainingThreads,
          runtimeBySessionId: remainingRuntime,
        });
      });

      await deleteSessionPersistence(root, sessionId);
      return true;
    },
    async clearActiveWorkspaceChatHistory(): Promise<boolean> {
      const sessionId = this.getActiveSessionId();
      if (!sessionId) {
        return false;
      }
      return this.deleteSession(sessionId);
    },
  };
}
