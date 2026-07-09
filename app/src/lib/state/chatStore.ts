import { derived, writable } from "svelte/store";
import type { CapabilityChecker, WorkspaceReadinessChecker } from "../ai/capabilities";
import type { ContextId } from "../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import { createAccessSlice } from "./chatStore/access";
import {
  createSessionsSlice,
  resetSessionIdCounterForTests,
  resetSessionHydrationForTests,
  createSessionId,
} from "./chatStore/sessions";
import { createRuntimeSlice, activeRuntime } from "./chatStore/runtime";
import { createThreadsSlice } from "./chatStore/threads";
import {
  formatCompactionNotice,
  setDefaultThreadConnectionResolver,
  setDefaultChatProviderResolver,
} from "./chatStore/threadHelpers";
import { activeThread, activeSessionId } from "./chatStore/workspace";
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
  WorkspaceSessionsState,
} from "./chatStore/types";
import { normalizeWorkspaceThreadsForScope } from "../ai/providers/threadScopeNormalization";
import {
  deriveSessionSubtitleFromThread,
  firstAssistantMessageContent,
} from "../services/chatSessions";
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
  WorkspaceSessionsState,
};

export {
  createSessionId,
  formatCompactionNotice,
  setDefaultThreadConnectionResolver,
  resetSessionIdCounterForTests,
  resetSessionHydrationForTests,
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
  const workspaceReadinessCheckerRef: { current: WorkspaceReadinessChecker | null } = {
    current: null,
  };

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
    getRuntimeState: (sessionId) => runtimeSlice.getRuntimeState(sessionId),
    capabilityCheckerRef,
  });
  const accessSlice = createAccessSlice({
    update,
    getSnapshot,
    getActiveChatScopeKey,
    getActiveWorkspaceRoot,
    getMetadata: (sessionId) => threadsSlice.getMetadata(sessionId),
    capabilityCheckerRef,
    workspaceReadinessCheckerRef,
  });
  const sessionsSlice = createSessionsSlice({ update, getSnapshot, getActiveChatScopeKey });

  return {
    subscribe,
    reset() {
      set(initialState);
      resetSessionIdCounterForTests();
      resetSessionHydrationForTests();
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
    ...sessionsSlice,
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

export const chatSessionIndex = derived(chatStore, ($chatStore) => {
  const scopeKey = $chatStore.activeChatScopeKey;
  if (!scopeKey) {
    return [];
  }
  return [...($chatStore.workspaces[scopeKey]?.sessionIndex ?? [])];
});

/**
 * M6-T4/T5 — active workspace's per-session runtime map, plus its scope key, so
 * the notification observer effect can react to session-state transitions for
 * every session (not only the selected one). Returns a fresh object reference on
 * every chatStore change so `$derived` re-runs downstream.
 */
export const chatActiveRuntimeBySessionId = derived(
  chatStore,
  ($chatStore) => {
    const scopeKey = $chatStore.activeChatScopeKey;
    if (!scopeKey) {
      return { scopeKey: null, runtimeBySessionId: {} };
    }
    const runtimeBySessionId = $chatStore.workspaces[scopeKey]?.runtimeBySessionId ?? {};
    return { scopeKey, runtimeBySessionId: { ...runtimeBySessionId } };
  },
);

export type ChatSessionSubtitle = {
  display: string;
  full: string;
};

export const chatSessionSubtitleById = derived(chatStore, ($chatStore) => {
  const scopeKey = $chatStore.activeChatScopeKey;
  if (!scopeKey) {
    return new Map<string, ChatSessionSubtitle>();
  }

  const workspace = $chatStore.workspaces[scopeKey];
  if (!workspace) {
    return new Map<string, ChatSessionSubtitle>();
  }

  const subtitles = new Map<string, ChatSessionSubtitle>();
  for (const [sessionId, thread] of Object.entries(workspace.threadsBySessionId)) {
    const display = deriveSessionSubtitleFromThread(thread);
    const full = thread ? firstAssistantMessageContent(thread.messages) : null;
    if (display && full) {
      subtitles.set(sessionId, { display, full });
    }
  }
  return subtitles;
});

export const chatActiveSessionId = derived(chatStore, ($chatStore) => activeSessionId($chatStore));
