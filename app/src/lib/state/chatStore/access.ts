import {
  WorkspaceAccessReason,
  type CapabilityChecker,
  type CapabilityCheckResult,
  type WorkspaceReadinessChecker,
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

export const stubWorkspaceReadinessChecker: WorkspaceReadinessChecker = {
  checkReadiness() {
    return { ready: true, message: "" };
  },
};

type ChatStoreUpdate = (mutator: (state: ChatStoreState) => ChatStoreState) => void;

export function createAccessSlice(deps: {
  update: ChatStoreUpdate;
  getSnapshot: () => ChatStoreState;
  getActiveChatScopeKey: () => import("./types").ChatScopeKey | null;
  getActiveWorkspaceRoot: () => string | null;
  getMetadata: (sessionId?: string) => import("../../domain/contracts").ChatThreadMetadata | null;
  capabilityCheckerRef: { current: CapabilityChecker | null };
  workspaceReadinessCheckerRef: { current: WorkspaceReadinessChecker | null };
}) {
  const {
    update,
    getSnapshot,
    getActiveWorkspaceRoot,
    getMetadata,
    capabilityCheckerRef,
    workspaceReadinessCheckerRef,
  } = deps;

  function resolveCapabilityChecker(): CapabilityChecker {
    return capabilityCheckerRef.current ?? stubCapabilityChecker;
  }

  function resolveWorkspaceReadinessChecker(): WorkspaceReadinessChecker {
    return workspaceReadinessCheckerRef.current ?? stubWorkspaceReadinessChecker;
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

  function appendSessionAccessLossMessage(rootPath: string, sessionId: string): void {
    const checkedAt = new Date().toISOString();
    update((state) => {
      const workspace = state.workspaces[rootPath];
      if (!workspace) {
        return state;
      }
      const thread = workspace.threadsBySessionId[sessionId];
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
        threadsBySessionId: {
          ...workspace.threadsBySessionId,
          [sessionId]: nextThread,
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
      const sessionsWithThreads = workspace
        ? Object.keys(workspace.threadsBySessionId).filter(
            (sessionId) => (workspace.threadsBySessionId[sessionId]?.messages.length ?? 0) > 0,
          )
        : [];
      for (const sessionId of sessionsWithThreads) {
        appendSessionAccessLossMessage(rootPath, sessionId);
      }
    }
    setWorkspaceAccessState(rootPath, nextState);
    return nextState;
  }

  return {
    setCapabilityChecker(checker: CapabilityChecker | null): void {
      capabilityCheckerRef.current = checker;
    },
    setWorkspaceReadinessChecker(checker: WorkspaceReadinessChecker | null): void {
      workspaceReadinessCheckerRef.current = checker;
    },
    async checkActiveWorkspaceCapabilities(sessionId?: string): Promise<CapabilityCheckResult> {
      const rootPath = getActiveWorkspaceRoot();
      const metadata = getMetadata(sessionId);

      if (!rootPath) {
        return {
          status: "unknown",
          reason: WorkspaceAccessReason.Unknown,
          capabilities: null,
          message: "Chat capability checks require an active workspace.",
        };
      }

      if (!metadata?.provider) {
        const readiness = resolveWorkspaceReadinessChecker().checkReadiness(rootPath);
        if (!readiness.ready) {
          return {
            status: "blocked",
            reason: WorkspaceAccessReason.MissingProviderConfig,
            capabilities: null,
            message: readiness.message,
            recoveryHint: readiness.recoveryHint,
          };
        }
        return {
          status: "ready",
          reason: WorkspaceAccessReason.Unknown,
          capabilities: {
            canReadWorkspaceFiles: true,
            supportedModes: [],
          },
          message: "OpenCode workspace session is ready.",
        };
      }

      const checker = resolveCapabilityChecker();
      return checker.checkCapabilities({
        provider: metadata.provider,
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
