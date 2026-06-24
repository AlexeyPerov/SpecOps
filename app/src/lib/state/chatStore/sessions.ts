import type { SessionIndexEntry } from "../../domain/contracts";
import { draftEntryTitleForScope, deriveSessionTitle } from "../../services/chatSessions";
import {
  deleteSessionPersistence,
  readSessionThreadFileSnapshot,
  readWorkspaceSessionsIndexSnapshot,
} from "../../services/chatPersistence";
import type { ChatStoreState, WorkspaceSessionsState } from "./types";
import {
  getOrCreateWorkspaceState,
  patchWorkspaceState,
  activeSessionId,
} from "./workspace";
import { normalizeThreadSnapshotForScope } from "../../ai/providers/threadScopeNormalization";
import { cloneThread } from "./threadHelpers";

let sessionIdCounter = 0;

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
    async loadWorkspaceSessions(normalizedRootPath: string): Promise<void> {
      const index = await readWorkspaceSessionsIndexSnapshot(normalizedRootPath);
      const threadsBySessionId: Record<string, import("../../domain/contracts").ChatThreadSnapshot | null> =
        {};
      for (const entry of index.sessions) {
        if (entry.isDraft) {
          continue;
        }
        const thread = await readSessionThreadFileSnapshot(normalizedRootPath, entry.id);
        threadsBySessionId[entry.id] = normalizeThreadForScope(
          normalizedRootPath,
          cloneThread(thread),
        );
      }

      update((state) => {
        const existing = state.workspaces[normalizedRootPath];
        const persistedIds = new Set(index.sessions.map((entry) => entry.id));
        const sessionDrafts = (existing?.sessionIndex ?? []).filter(
          (entry) => entry.isDraft && !persistedIds.has(entry.id),
        );
        const mergedIndex = [...index.sessions, ...sessionDrafts];
        const mergedIds = new Set(mergedIndex.map((entry) => entry.id));
        const mergedThreadsBySessionId = { ...threadsBySessionId };
        const mergedRuntimeBySessionId = { ...(existing?.runtimeBySessionId ?? {}) };
        for (const draft of sessionDrafts) {
          if (existing?.threadsBySessionId[draft.id]) {
            mergedThreadsBySessionId[draft.id] = existing.threadsBySessionId[draft.id];
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
