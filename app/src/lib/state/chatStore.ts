import { derived, writable } from "svelte/store";
import type { CapabilityChecker } from "../ai/capabilities";
import { createAccessSlice } from "./chatStore/access";
import { createAgentsSlice, resetAgentIdCounterForTests, createAgentId } from "./chatStore/agents";
import { createRuntimeSlice, activeRuntime } from "./chatStore/runtime";
import { createThreadsSlice } from "./chatStore/threads";
import {
  formatCompactionNotice,
  setDefaultChatProviderResolver,
} from "./chatStore/threadHelpers";
import { activeThread, activeAgentId } from "./chatStore/workspace";
import { defaultUnknownAccessState } from "./chatStore/access";
import type {
  ChatAccessState,
  ChatModelSwitchOptions,
  ChatProviderSwitchOptions,
  ChatStoreState,
  ChatThreadRuntimeState,
  ChatTurnError,
  SwitchThreadModelResult,
  SwitchThreadProviderResult,
  WorkspaceAgentsState,
} from "./chatStore/types";

export type {
  ChatAccessState,
  ChatModelSwitchOptions,
  ChatProviderSwitchOptions,
  ChatThreadRuntimeState,
  ChatTurnError,
  SwitchThreadModelResult,
  SwitchThreadProviderResult,
  WorkspaceAgentsState,
};

export {
  createAgentId,
  formatCompactionNotice,
  resetAgentIdCounterForTests,
  setDefaultChatProviderResolver,
};

const initialState: ChatStoreState = {
  activeWorkspaceRoot: null,
  workspaces: {},
  accessByWorkspace: {},
};

function createChatStore() {
  const { subscribe, set, update } = writable<ChatStoreState>(initialState);
  const capabilityCheckerRef: { current: CapabilityChecker | null } = { current: null };

  function getSnapshot(): ChatStoreState {
    let snapshot = initialState;
    const un = subscribe((state) => {
      snapshot = state;
    });
    un();
    return snapshot;
  }

  function getActiveWorkspaceRoot(): string | null {
    return getSnapshot().activeWorkspaceRoot;
  }

  const runtimeSlice = createRuntimeSlice({ update, getSnapshot, getActiveWorkspaceRoot });
  const threadsSlice = createThreadsSlice({
    update,
    getSnapshot,
    getActiveWorkspaceRoot,
    getRuntimeState: (agentId) => runtimeSlice.getRuntimeState(agentId),
    capabilityCheckerRef,
  });
  const accessSlice = createAccessSlice({
    update,
    getSnapshot,
    getActiveWorkspaceRoot,
    getMetadata: (agentId) => threadsSlice.getMetadata(agentId),
    capabilityCheckerRef,
  });
  const agentsSlice = createAgentsSlice({ update, getSnapshot, getActiveWorkspaceRoot });

  return {
    subscribe,
    reset() {
      set(initialState);
      resetAgentIdCounterForTests();
    },
    getSnapshot,
    setActiveWorkspaceRoot(normalizedRootPath: string | null): void {
      update((state) => {
        if (state.activeWorkspaceRoot === normalizedRootPath) {
          return state;
        }
        return {
          ...state,
          activeWorkspaceRoot: normalizedRootPath,
        };
      });
    },
    getActiveWorkspaceRoot,
    setDefaultChatProviderResolver,
    ...agentsSlice,
    ...threadsSlice,
    ...runtimeSlice,
    ...accessSlice,
  };
}

export const chatStore = createChatStore();

export const chatMessages = derived(chatStore, ($chatStore) => activeThread($chatStore)?.messages ?? []);
export const chatMetadata = derived(chatStore, ($chatStore) => activeThread($chatStore)?.metadata ?? null);
export const chatHasThread = derived(chatStore, ($chatStore) => activeThread($chatStore) !== null);
export const chatIsEmpty = derived(
  chatStore,
  ($chatStore) => (activeThread($chatStore)?.messages.length ?? 0) === 0,
);
export const chatAccessState = derived(chatStore, ($chatStore) => {
  const rootPath = $chatStore.activeWorkspaceRoot;
  if (!rootPath) {
    return defaultUnknownAccessState("Open a workspace to use AI chat.");
  }
  return (
    $chatStore.accessByWorkspace[rootPath] ??
    defaultUnknownAccessState("Chat access preflight has not run yet.")
  );
});
export const chatRuntimeState = derived(chatStore, ($chatStore) => activeRuntime($chatStore));
export const chatIsGenerating = derived(chatRuntimeState, ($runtime) => $runtime.isGenerating);
export const chatLastError = derived(chatRuntimeState, ($runtime) => $runtime.lastError);
export const chatCanRetryLastTurn = derived(chatRuntimeState, ($runtime) =>
  Boolean($runtime.lastFailedTurnId && !$runtime.isGenerating),
);

export const chatAgentIndex = derived(chatStore, ($chatStore) => {
  const root = $chatStore.activeWorkspaceRoot;
  if (!root) {
    return [];
  }
  return [...($chatStore.workspaces[root]?.agentIndex ?? [])];
});

export const chatActiveAgentId = derived(chatStore, ($chatStore) => activeAgentId($chatStore));
