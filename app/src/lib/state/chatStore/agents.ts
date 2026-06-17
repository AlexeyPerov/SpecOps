import type { AgentIndexEntry } from "../../domain/contracts";
import { draftEntryTitleForScope, deriveAgentTitle } from "../../services/chatAgents";
import {
  deleteAgentPersistence,
  readAgentThreadFileSnapshot,
  readWorkspaceAgentsIndexSnapshot,
} from "../../services/chatPersistence";
import type { ChatStoreState, WorkspaceAgentsState } from "./types";
import {
  getOrCreateWorkspaceState,
  patchWorkspaceState,
  activeAgentId,
} from "./workspace";
import { normalizeThreadSnapshotForScope } from "../../ai/providers/threadScopeNormalization";
import { cloneThread } from "./threadHelpers";

let agentIdCounter = 0;

function parseAgentCounterFromId(agentId: string): number | null {
  const match = /^agent-(\d+)$/.exec(agentId);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Clears agent id counter between unit tests. */
export function resetAgentIdCounterForTests(): void {
  agentIdCounter = 0;
}

export function createAgentId(): string {
  agentIdCounter += 1;
  return `agent-${agentIdCounter}`;
}

export function createDraftAgentEntry(
  agentId: string,
  lastUsedAt: string,
  scopeKey?: string | null,
): AgentIndexEntry {
  return {
    id: agentId,
    title: draftEntryTitleForScope(scopeKey),
    lastUsedAt,
    isDraft: true,
  };
}

export function findAgentIndexEntry(
  workspace: WorkspaceAgentsState,
  agentId: string,
): AgentIndexEntry | undefined {
  return workspace.agentIndex.find((entry) => entry.id === agentId);
}

export function isDraftAgentEntry(entry: AgentIndexEntry | undefined): boolean {
  return entry?.isDraft === true;
}

export function promoteDraftAgentIndexEntry(
  entry: AgentIndexEntry,
  firstUserMessageContent: string,
  lastUsedAt: string,
): AgentIndexEntry {
  return {
    id: entry.id,
    title: deriveAgentTitle({ firstUserMessage: firstUserMessageContent }),
    lastUsedAt,
  };
}

export function patchAgentIndexEntry(
  agentIndex: AgentIndexEntry[],
  agentId: string,
  nextEntry: AgentIndexEntry,
): AgentIndexEntry[] {
  return agentIndex.map((entry) => (entry.id === agentId ? nextEntry : entry));
}

export interface AgentSessionLinkPatch {
  opencodeSessionId?: string;
  opencodeModelId?: string;
  opencodeProviderId?: string;
  opencodeShareUrl?: string;
  opencodeParentSessionId?: string;
}

function applyAgentSessionLinkPatch(
  entry: AgentIndexEntry,
  patch: AgentSessionLinkPatch,
): AgentIndexEntry {
  const next: AgentIndexEntry = {
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

function didSessionLinkChange(entry: AgentIndexEntry, patch: AgentSessionLinkPatch): boolean {
  const next = applyAgentSessionLinkPatch(entry, patch);
  return (
    next.opencodeSessionId !== entry.opencodeSessionId ||
    next.opencodeModelId !== entry.opencodeModelId ||
    next.opencodeProviderId !== entry.opencodeProviderId ||
    next.opencodeShareUrl !== entry.opencodeShareUrl ||
    next.opencodeParentSessionId !== entry.opencodeParentSessionId
  );
}

export function resolveTargetAgentId(state: ChatStoreState, agentId?: string): string | null {
  if (agentId) {
    return agentId;
  }
  return activeAgentId(state);
}

export function ensureActiveAgent(
  state: ChatStoreState,
): { state: ChatStoreState; workspace: WorkspaceAgentsState; agentId: string } | null {
  const root = state.activeChatScopeKey;
  if (!root) {
    return null;
  }

  const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
  if (workspace.activeAgentId) {
    return { state: nextState, workspace, agentId: workspace.activeAgentId };
  }

  const agentId = createAgentId();
  const lastUsedAt = new Date().toISOString();
  const nextWorkspace: WorkspaceAgentsState = {
    ...workspace,
    activeAgentId: agentId,
    agentIndex: [...workspace.agentIndex, createDraftAgentEntry(agentId, lastUsedAt, root)],
  };

  return {
    state: patchWorkspaceState(nextState, root, nextWorkspace),
    workspace: nextWorkspace,
    agentId,
  };
}

type ChatStoreUpdate = (mutator: (state: ChatStoreState) => ChatStoreState) => void;

export function createAgentsSlice(deps: {
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

  function syncAgentIdCounterFromWorkspace(workspace: WorkspaceAgentsState): void {
    let maxCounter = agentIdCounter;
    for (const entry of workspace.agentIndex) {
      const parsed = parseAgentCounterFromId(entry.id);
      if (parsed !== null && parsed > maxCounter) {
        maxCounter = parsed;
      }
    }
    agentIdCounter = maxCounter;
  }

  return {
    getActiveAgentId(): string | null {
      return activeAgentId(getSnapshot());
    },
    setActiveAgentId(agentId: string | null): void {
      update((state) => {
        const root = state.activeChatScopeKey;
        if (!root) {
          return state;
        }
        const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
        if (workspace.activeAgentId === agentId) {
          return nextState;
        }
        return patchWorkspaceState(nextState, root, {
          ...workspace,
          activeAgentId: agentId,
        });
      });
    },
    createDraftAgent(options?: { activate?: boolean }): string | null {
      const root = getActiveChatScopeKey();
      if (!root) {
        return null;
      }

      let createdAgentId: string | null = null;
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
        const agentId = createAgentId();
        const lastUsedAt = new Date().toISOString();
        const activate = options?.activate !== false;
        createdAgentId = agentId;
        return patchWorkspaceState(nextState, root, {
          ...workspace,
          activeAgentId: activate ? agentId : workspace.activeAgentId,
          agentIndex: [...workspace.agentIndex, createDraftAgentEntry(agentId, lastUsedAt, root)],
        });
      });
      return createdAgentId;
    },
    isAgentDraft(agentId: string): boolean {
      const root = getActiveChatScopeKey();
      if (!root) {
        return false;
      }
      const workspace = getSnapshot().workspaces[root];
      if (!workspace) {
        return false;
      }
      return isDraftAgentEntry(findAgentIndexEntry(workspace, agentId));
    },
    getAgentTitle(agentId: string): string | null {
      const root = getActiveChatScopeKey();
      if (!root) {
        return null;
      }
      const workspace = getSnapshot().workspaces[root];
      if (!workspace) {
        return null;
      }
      return findAgentIndexEntry(workspace, agentId)?.title ?? null;
    },
    getAgentIndex(): AgentIndexEntry[] {
      const root = getActiveChatScopeKey();
      if (!root) {
        return [];
      }
      return [...(getSnapshot().workspaces[root]?.agentIndex ?? [])];
    },
    getAgentSessionLink(
      agentId: string,
      rootOverride?: string | null,
    ): AgentSessionLinkPatch | null {
      const root = rootOverride ?? getActiveChatScopeKey();
      if (!root) {
        return null;
      }
      const workspace = getSnapshot().workspaces[root];
      if (!workspace) {
        return null;
      }
      const entry = findAgentIndexEntry(workspace, agentId);
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
    setAgentSessionLink(
      agentId: string,
      patch: AgentSessionLinkPatch,
      rootOverride?: string | null,
    ): boolean {
      const root = rootOverride ?? getActiveChatScopeKey();
      if (!root) {
        return false;
      }
      let changed = false;
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
        const entry = findAgentIndexEntry(workspace, agentId);
        if (!entry) {
          return nextState;
        }
        if (!didSessionLinkChange(entry, patch)) {
          return nextState;
        }
        changed = true;
        return patchWorkspaceState(nextState, root, {
          ...workspace,
          agentIndex: patchAgentIndexEntry(
            workspace.agentIndex,
            agentId,
            applyAgentSessionLinkPatch(entry, patch),
          ),
        });
      });
      return changed;
    },
    clearAgentSessionLink(agentId: string, rootOverride?: string | null): boolean {
      return this.setAgentSessionLink(
        agentId,
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
     * Rename an agent tab (M2-T1). Updates `title` and bumps `lastUsedAt` so
     * the row re-sorts to the top of the sidebar. Returns false when the
     * agent isn't found or the trimmed title is empty. Does NOT call OpenCode
     * — the caller (handler) is responsible for `session.update({ title })`
     * and only invokes this once that succeeds.
     */
    renameAgent(agentId: string, title: string, rootOverride?: string | null): boolean {
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
        const entry = findAgentIndexEntry(workspace, agentId);
        if (!entry) {
          return state;
        }
        if (entry.title === trimmed) {
          renamed = true;
          return state;
        }
        renamed = true;
        const nextEntry: AgentIndexEntry = {
          ...entry,
          title: trimmed,
          lastUsedAt: new Date().toISOString(),
        };
        return patchWorkspaceState(state, root, {
          ...workspace,
          agentIndex: patchAgentIndexEntry(workspace.agentIndex, agentId, nextEntry),
        });
      });
      return renamed;
    },
    /**
     * Create a fresh agent tab linked to a (just-forked) OpenCode session
     * (M2-T3). The new entry is non-draft and active so the UI opens it. The
     * caller (handler) is responsible for calling `session.fork` first and
     * passing the child session id + parent id here. Returns the new agent id.
     *
     * `modelId` / `providerId` are inherited from the parent entry when not
     * supplied, so the forked tab keeps the same model selection.
     */
    forkAgent(
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
      const parentEntry = workspace.agentIndex.find(
        (entry) => entry.opencodeSessionId === link.opencodeParentSessionId,
      );
      const modelId = link.opencodeModelId ?? parentEntry?.opencodeModelId;
      const providerId = link.opencodeProviderId ?? parentEntry?.opencodeProviderId;
      const title =
        link.title?.trim() ||
        (parentEntry ? `${parentEntry.title} (fork)` : "Forked session");
      const agentId = createAgentId();
      const lastUsedAt = new Date().toISOString();
      const entry: AgentIndexEntry = {
        id: agentId,
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
          activeAgentId: agentId,
          agentIndex: [...ws.agentIndex, entry],
        });
      });
      return agentId;
    },
    getWorkspaceAgentsState(root: string): WorkspaceAgentsState | null {
      const workspace = getSnapshot().workspaces[root];
      if (!workspace) {
        return null;
      }
      return {
        activeAgentId: workspace.activeAgentId,
        agentIndex: [...workspace.agentIndex],
        threadsByAgentId: { ...workspace.threadsByAgentId },
        runtimeByAgentId: { ...workspace.runtimeByAgentId },
      };
    },
    async loadWorkspaceAgents(normalizedRootPath: string): Promise<void> {
      const index = await readWorkspaceAgentsIndexSnapshot(normalizedRootPath);
      const threadsByAgentId: Record<string, import("../../domain/contracts").ChatThreadSnapshot | null> =
        {};
      for (const entry of index.agents) {
        if (entry.isDraft) {
          continue;
        }
        const thread = await readAgentThreadFileSnapshot(normalizedRootPath, entry.id);
        threadsByAgentId[entry.id] = normalizeThreadForScope(
          normalizedRootPath,
          cloneThread(thread),
        );
      }

      update((state) => {
        const existing = state.workspaces[normalizedRootPath];
        const persistedIds = new Set(index.agents.map((entry) => entry.id));
        const sessionDrafts = (existing?.agentIndex ?? []).filter(
          (entry) => entry.isDraft && !persistedIds.has(entry.id),
        );
        const mergedIndex = [...index.agents, ...sessionDrafts];
        const mergedIds = new Set(mergedIndex.map((entry) => entry.id));
        const mergedThreadsByAgentId = { ...threadsByAgentId };
        const mergedRuntimeByAgentId = { ...(existing?.runtimeByAgentId ?? {}) };
        for (const draft of sessionDrafts) {
          if (existing?.threadsByAgentId[draft.id]) {
            mergedThreadsByAgentId[draft.id] = existing.threadsByAgentId[draft.id];
          }
          if (existing?.runtimeByAgentId[draft.id]) {
            mergedRuntimeByAgentId[draft.id] = existing.runtimeByAgentId[draft.id];
          }
        }
        const activeAgentIdValue =
          existing?.activeAgentId && mergedIds.has(existing.activeAgentId)
            ? existing.activeAgentId
            : null;
        syncAgentIdCounterFromWorkspace({
          activeAgentId: activeAgentIdValue,
          agentIndex: mergedIndex,
          threadsByAgentId: mergedThreadsByAgentId,
          runtimeByAgentId: mergedRuntimeByAgentId,
        });

        return {
          ...state,
          workspaces: {
            ...state.workspaces,
            [normalizedRootPath]: {
              activeAgentId: activeAgentIdValue,
              agentIndex: mergedIndex,
              threadsByAgentId: mergedThreadsByAgentId,
              runtimeByAgentId: mergedRuntimeByAgentId,
            },
          },
        };
      });
    },
    mergeSessionDraftAgents(normalizedRootPath: string, agentIds: readonly string[]): void {
      if (agentIds.length === 0) {
        return;
      }
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, normalizedRootPath);
        const knownIds = new Set(workspace.agentIndex.map((entry) => entry.id));
        const additions: AgentIndexEntry[] = [];
        const lastUsedAt = new Date().toISOString();
        for (const agentId of agentIds) {
          if (knownIds.has(agentId)) {
            continue;
          }
          knownIds.add(agentId);
          additions.push(createDraftAgentEntry(agentId, lastUsedAt, normalizedRootPath));
        }
        if (additions.length === 0) {
          return nextState;
        }
        syncAgentIdCounterFromWorkspace({
          ...workspace,
          agentIndex: [...workspace.agentIndex, ...additions],
        });
        return patchWorkspaceState(nextState, normalizedRootPath, {
          ...workspace,
          agentIndex: [...workspace.agentIndex, ...additions],
        });
      });
    },
    /** @deprecated Use loadWorkspaceAgents. */
    async loadWorkspaceThread(normalizedRootPath: string): Promise<void> {
      await this.loadWorkspaceAgents(normalizedRootPath);
    },
    async deleteAgent(agentId: string): Promise<boolean> {
      const root = getActiveChatScopeKey();
      if (!root) {
        return false;
      }

      update((state) => {
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }

        const { [agentId]: _removedThread, ...remainingThreads } = workspace.threadsByAgentId;
        const { [agentId]: _removedRuntime, ...remainingRuntime } = workspace.runtimeByAgentId;
        const nextActiveAgentId =
          workspace.activeAgentId === agentId ? null : workspace.activeAgentId;

        return patchWorkspaceState(state, root, {
          ...workspace,
          activeAgentId: nextActiveAgentId,
          agentIndex: workspace.agentIndex.filter((entry) => entry.id !== agentId),
          threadsByAgentId: remainingThreads,
          runtimeByAgentId: remainingRuntime,
        });
      });

      await deleteAgentPersistence(root, agentId);
      return true;
    },
    async clearActiveWorkspaceChatHistory(): Promise<boolean> {
      const agentId = this.getActiveAgentId();
      if (!agentId) {
        return false;
      }
      return this.deleteAgent(agentId);
    },
  };
}
