import type { AgentIndexEntry } from "../../domain/contracts";
import { DRAFT_AGENT_TITLE, deriveAgentTitle } from "../../services/chatAgents";
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
import { cloneThread } from "./threadHelpers";

let agentIdCounter = 0;

/** Clears agent id counter between unit tests. */
export function resetAgentIdCounterForTests(): void {
  agentIdCounter = 0;
}

export function createAgentId(): string {
  agentIdCounter += 1;
  return `agent-${agentIdCounter}`;
}

export function createDraftAgentEntry(agentId: string, lastUsedAt: string): AgentIndexEntry {
  return {
    id: agentId,
    title: DRAFT_AGENT_TITLE,
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

export function resolveTargetAgentId(state: ChatStoreState, agentId?: string): string | null {
  if (agentId) {
    return agentId;
  }
  return activeAgentId(state);
}

export function ensureActiveAgent(
  state: ChatStoreState,
): { state: ChatStoreState; workspace: WorkspaceAgentsState; agentId: string } | null {
  const root = state.activeWorkspaceRoot;
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
    agentIndex: [...workspace.agentIndex, createDraftAgentEntry(agentId, lastUsedAt)],
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
  getActiveWorkspaceRoot: () => string | null;
}) {
  const { update, getSnapshot, getActiveWorkspaceRoot } = deps;

  return {
    getActiveAgentId(): string | null {
      return activeAgentId(getSnapshot());
    },
    setActiveAgentId(agentId: string | null): void {
      update((state) => {
        const root = state.activeWorkspaceRoot;
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
      const root = getActiveWorkspaceRoot();
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
          agentIndex: [...workspace.agentIndex, createDraftAgentEntry(agentId, lastUsedAt)],
        });
      });
      return createdAgentId;
    },
    isAgentDraft(agentId: string): boolean {
      const root = getActiveWorkspaceRoot();
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
      const root = getActiveWorkspaceRoot();
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
      const root = getActiveWorkspaceRoot();
      if (!root) {
        return [];
      }
      return [...(getSnapshot().workspaces[root]?.agentIndex ?? [])];
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
        threadsByAgentId[entry.id] = cloneThread(thread);
      }

      update((state) => {
        const existing = state.workspaces[normalizedRootPath];
        const activeAgentIdValue =
          existing?.activeAgentId && index.agents.some((entry) => entry.id === existing.activeAgentId)
            ? existing.activeAgentId
            : null;

        return {
          ...state,
          workspaces: {
            ...state.workspaces,
            [normalizedRootPath]: {
              activeAgentId: activeAgentIdValue,
              agentIndex: index.agents,
              threadsByAgentId,
              runtimeByAgentId: existing?.runtimeByAgentId ?? {},
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
          additions.push(createDraftAgentEntry(agentId, lastUsedAt));
        }
        if (additions.length === 0) {
          return nextState;
        }
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
      const root = getActiveWorkspaceRoot();
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
