import { derived, writable } from "svelte/store";
import type { CapabilityChecker } from "../ai/capabilities";
import type { ContextId } from "../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import { createAccessSlice } from "./chatStore/access";
import { createAgentsSlice, resetAgentIdCounterForTests, createAgentId } from "./chatStore/agents";
import { createRuntimeSlice, activeRuntime } from "./chatStore/runtime";
import { createThreadsSlice } from "./chatStore/threads";
import {
  formatCompactionNotice,
  setDefaultThreadConnectionResolver,
  setDefaultChatProviderResolver,
} from "./chatStore/threadHelpers";
import { activeThread, activeAgentId } from "./chatStore/workspace";
import { defaultUnknownAccessState } from "./chatStore/access";
import type {
  ChatAccessState,
  ChatModelSwitchOptions,
  ChatProviderSwitchOptions,
  ChatScopeKey,
  ChatStoreState,
  ChatThreadRuntimeState,
  ChatTurnError,
  SwitchThreadModelResult,
  SwitchThreadConnectionResult,
  SwitchThreadProviderResult,
  WorkspaceAgentsState,
} from "./chatStore/types";
import { normalizeWorkspaceThreadsForScope } from "../ai/providers/threadScopeNormalization";
import { chatScopeKeyForContextId, isChatContextScopeKey } from "./chatStore/types";

export type {
  ChatAccessState,
  ChatModelSwitchOptions,
  ChatProviderSwitchOptions,
  ChatScopeKey,
  ChatThreadRuntimeState,
  ChatTurnError,
  SwitchThreadModelResult,
  SwitchThreadConnectionResult,
  SwitchThreadProviderResult,
  WorkspaceAgentsState,
};

export {
  createAgentId,
  formatCompactionNotice,
  setDefaultThreadConnectionResolver,
  resetAgentIdCounterForTests,
  setDefaultChatProviderResolver,
};

const initialState: ChatStoreState = {
  activeChatScopeKey: null,
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

  function getActiveChatScopeKey(): ChatScopeKey | null {
    return getSnapshot().activeChatScopeKey;
  }

  function getActiveWorkspaceRoot(): string | null {
    const scopeKey = getActiveChatScopeKey();
    if (!scopeKey || isChatContextScopeKey(scopeKey)) {
      return null;
    }
    return scopeKey;
  }

  const runtimeSlice = createRuntimeSlice({ update, getSnapshot, getActiveChatScopeKey });
  const threadsSlice = createThreadsSlice({
    update,
    getSnapshot,
    getActiveChatScopeKey,
    getRuntimeState: (agentId) => runtimeSlice.getRuntimeState(agentId),
    capabilityCheckerRef,
  });
  const accessSlice = createAccessSlice({
    update,
    getSnapshot,
    getActiveChatScopeKey,
    getActiveWorkspaceRoot,
    getMetadata: (agentId) => threadsSlice.getMetadata(agentId),
    capabilityCheckerRef,
  });
  const agentsSlice = createAgentsSlice({ update, getSnapshot, getActiveChatScopeKey });

  return {
    subscribe,
    reset() {
      set(initialState);
      resetAgentIdCounterForTests();
    },
    getSnapshot,
    setActiveChatScopeKey(scopeKey: ChatScopeKey | null): void {
      update((state) => {
        if (state.activeChatScopeKey === scopeKey) {
          return state;
        }
        let next: ChatStoreState = {
          ...state,
          activeChatScopeKey: scopeKey,
        };
        if (scopeKey) {
          next = normalizeWorkspaceThreadsForScope(next, scopeKey);
        }
        return next;
      });
    },
    setActiveWorkspaceRoot(normalizedRootPath: string | null): void {
      this.setActiveChatScopeKey(normalizedRootPath);
    },
    setActiveChatScope(contextId: ContextId): void {
      const scopeKey = chatScopeKeyForContextId(contextId);
      if (!scopeKey) {
        return;
      }
      this.setActiveChatScopeKey(scopeKey);
    },
    getActiveChatScopeKey,
    getActiveWorkspaceRoot,
    setDefaultChatProviderResolver,
    setDefaultThreadConnectionResolver,
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
  const scopeKey = $chatStore.activeChatScopeKey;
  if (!scopeKey || isChatContextScopeKey(scopeKey)) {
    return defaultUnknownAccessState("Open a workspace to use workspace AI chat.");
  }
  return (
    $chatStore.accessByWorkspace[scopeKey] ??
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
  const scopeKey = $chatStore.activeChatScopeKey;
  if (!scopeKey) {
    return [];
  }
  return [...($chatStore.workspaces[scopeKey]?.agentIndex ?? [])];
});

export const chatActiveAgentId = derived(chatStore, ($chatStore) => activeAgentId($chatStore));
