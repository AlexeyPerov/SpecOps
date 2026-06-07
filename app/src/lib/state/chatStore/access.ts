import {
  WorkspaceAccessReason,
  type CapabilityChecker,
  type CapabilityCheckResult,
} from "../../ai/capabilities";
import {
  WORKSPACE_ACCESS_LOST_MESSAGE,
  WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
  WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
} from "../../ai/chatErrorCopy";
import { ensureWorkspaceReadAccess } from "../../services/fileSystem";
import type { ChatAccessState, ChatStoreState } from "./types";
import { patchWorkspaceState } from "./workspace";
import { cloneThread } from "./threadHelpers";
import { getDefaultChatProvider } from "./threadHelpers";

export function defaultUnknownAccessState(message: string): ChatAccessState {
  return {
    status: "unknown",
    reason: WorkspaceAccessReason.Unknown,
    message,
    checkedAt: new Date().toISOString(),
  };
}

export const stubCapabilityChecker: CapabilityChecker = {
  async checkCapabilities() {
    return {
      status: "blocked",
      reason: WorkspaceAccessReason.ProviderUnsupported,
      capabilities: {
        canReadWorkspaceFiles: false,
        supportedModes: [],
      },
      message: "Provider capability checks are not integrated yet for this milestone.",
      recoveryHint: "Provider integration arrives in a later milestone.",
    };
  },
};

type ChatStoreUpdate = (mutator: (state: ChatStoreState) => ChatStoreState) => void;

export function createAccessSlice(deps: {
  update: ChatStoreUpdate;
  getSnapshot: () => ChatStoreState;
  getActiveChatScopeKey: () => import("./types").ChatScopeKey | null;
  getActiveWorkspaceRoot: () => string | null;
  getMetadata: (agentId?: string) => import("../../domain/contracts").ChatThreadMetadata | null;
  capabilityCheckerRef: { current: CapabilityChecker | null };
}) {
  const { update, getSnapshot, getActiveWorkspaceRoot, getMetadata, capabilityCheckerRef } = deps;

  function resolveCapabilityChecker(): CapabilityChecker {
    return capabilityCheckerRef.current ?? stubCapabilityChecker;
  }

  function setWorkspaceAccessState(rootPath: string, next: ChatAccessState): void {
    update((state) => ({
      ...state,
      accessByWorkspace: {
        ...state.accessByWorkspace,
        [rootPath]: next,
      },
    }));
  }

  function appendAgentAccessLossMessage(rootPath: string, agentId: string): void {
    const checkedAt = new Date().toISOString();
    update((state) => {
      const workspace = state.workspaces[rootPath];
      if (!workspace) {
        return state;
      }
      const thread = workspace.threadsByAgentId[agentId];
      if (!thread || thread.messages.length === 0) {
        return state;
      }
      const lastMessage = thread.messages[thread.messages.length - 1];
      if (
        lastMessage.role === "system" &&
        lastMessage.content === WORKSPACE_ACCESS_LOST_MESSAGE
      ) {
        return state;
      }
      const nextThread = cloneThread(thread);
      if (!nextThread) {
        return state;
      }
      nextThread.messages = [
        ...nextThread.messages,
        {
          id: `access-loss-${checkedAt}`,
          role: "system",
          content: WORKSPACE_ACCESS_LOST_MESSAGE,
          createdAt: checkedAt,
        },
      ];
      nextThread.metadata = {
        ...nextThread.metadata,
        updatedAt: checkedAt,
      };
      return patchWorkspaceState(state, rootPath, {
        ...workspace,
        threadsByAgentId: {
          ...workspace.threadsByAgentId,
          [agentId]: nextThread,
        },
      });
    });
  }

  function commitAccessPreflightResult(
    rootPath: string,
    nextState: ChatAccessState,
    previousState: ChatAccessState | undefined,
    snapshot: ChatStoreState,
  ): ChatAccessState {
    if (
      previousState?.status === "ready" &&
      nextState.status === "blocked" &&
      nextState.reason === WorkspaceAccessReason.WorkspacePathInaccessible
    ) {
      const workspace = snapshot.workspaces[rootPath];
      const agentsWithThreads = workspace
        ? Object.keys(workspace.threadsByAgentId).filter(
            (agentId) => (workspace.threadsByAgentId[agentId]?.messages.length ?? 0) > 0,
          )
        : [];
      for (const agentId of agentsWithThreads) {
        appendAgentAccessLossMessage(rootPath, agentId);
      }
    }
    setWorkspaceAccessState(rootPath, nextState);
    return nextState;
  }

  return {
    setCapabilityChecker(checker: CapabilityChecker | null): void {
      capabilityCheckerRef.current = checker;
    },
    async checkActiveWorkspaceCapabilities(agentId?: string): Promise<CapabilityCheckResult> {
      const rootPath = getActiveWorkspaceRoot();
      const metadata = getMetadata(agentId);

      if (!rootPath) {
        return {
          status: "unknown",
          reason: WorkspaceAccessReason.Unknown,
          capabilities: null,
          message: "Chat capability checks require an active workspace.",
        };
      }

      const checker = resolveCapabilityChecker();
      return checker.checkCapabilities({
        provider: metadata?.provider ?? getDefaultChatProvider(),
        mode: metadata?.mode ?? "ask",
        workspaceRootPath: rootPath,
        connectionId: metadata?.connectionId,
      });
    },
    getChatAccessState(): ChatAccessState {
      const rootPath = getActiveWorkspaceRoot();
      if (!rootPath) {
        return defaultUnknownAccessState("Open a workspace to use workspace AI chat.");
      }
      const snapshot = getSnapshot();
      return (
        snapshot.accessByWorkspace[rootPath] ??
        defaultUnknownAccessState("Chat access preflight has not run yet.")
      );
    },
    async runAccessPreflight(): Promise<ChatAccessState> {
      const rootPath = getActiveWorkspaceRoot();
      if (!rootPath) {
        return defaultUnknownAccessState("Open a workspace to use workspace AI chat.");
      }
      const snapshot = getSnapshot();

      const previousState = snapshot.accessByWorkspace[rootPath];

      const workspaceAccess = await ensureWorkspaceReadAccess(rootPath);
      if (workspaceAccess !== "ready") {
        const blockedState: ChatAccessState = {
          status: "blocked",
          reason: WorkspaceAccessReason.WorkspacePathInaccessible,
          message: WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
          recoveryHint: WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
          checkedAt: new Date().toISOString(),
        };
        return commitAccessPreflightResult(rootPath, blockedState, previousState, snapshot);
      }

      const capabilityResult = await this.checkActiveWorkspaceCapabilities();
      const nextState: ChatAccessState = {
        status: capabilityResult.status,
        reason: capabilityResult.reason,
        message: capabilityResult.message,
        recoveryHint: capabilityResult.recoveryHint,
        checkedAt: new Date().toISOString(),
      };
      return commitAccessPreflightResult(rootPath, nextState, previousState, snapshot);
    },
  };
}
