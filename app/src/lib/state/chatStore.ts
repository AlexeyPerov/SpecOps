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
  SessionIndexEntry,
  SwitchThreadModelResult,
  SwitchThreadConnectionResult,
  SwitchThreadProviderResult,
  WorkspaceSessionsState,
} from "./chatStore/types";
import type { ChatMessage } from "../domain/chat";
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

  // Maintain the latest state via a single long-lived subscription instead of
  // doing a subscribe/unsubscribe dance on every getSnapshot() call. See
  // appState.ts for rationale.
  let currentSnapshot: ChatStoreState = initialState;
  subscribe((state) => {
    currentSnapshot = state;
  });

  function getSnapshot(): ChatStoreState {
    return currentSnapshot;
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

// Stable empty-container references so downstream `derived`/`$derived` consumers
// can short-circuit on referential equality when nothing has actually changed.
// Without these, every chatStore emit allocates new `[]`/`{}`/`Map` values even
// when the underlying data is identical, forcing cascading recomputations
// (e.g. during per-token chat-streaming emits).
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_SESSION_INDEX: SessionIndexEntry[] = [];
const EMPTY_SUBTITLE_MAP = new Map<string, ChatSessionSubtitle>();

export const chatMessages = derived(chatStore, ($chatStore) => activeThread($chatStore)?.messages ?? EMPTY_MESSAGES);
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
    return EMPTY_SESSION_INDEX;
  }
  const sessionIndex = $chatStore.workspaces[scopeKey]?.sessionIndex;
  if (!sessionIndex || sessionIndex.length === 0) {
    return EMPTY_SESSION_INDEX;
  }
  return [...sessionIndex];
});

export type ChatSessionRuntimeMap = {
  scopeKey: ChatScopeKey | null;
  runtimeBySessionId: Record<string, ChatThreadRuntimeState>;
};

/**
 * Active workspace's per-session runtime map, plus its scope key, so the
 * notification observer effect can react to session-state transitions for every
 * session (not only the selected one).
 *
 * Referential stability: the wrapper object is only re-allocated when the
 * underlying `runtimeBySessionId` map reference actually changes (or the scope
 * key changes). This lets downstream `$derived`/`$effect` consumers skip work
 * on unrelated chatStore emits (e.g. per-token streaming in a different
 * session). The workspace slice replaces the map instance on real runtime
 * transitions, so a `!==` reference check is sufficient.
 */
let lastRuntimeInput: { scopeKey: ChatScopeKey | null; mapRef: unknown } | null = null;
let lastRuntimeOutput: ChatSessionRuntimeMap = {
  scopeKey: null,
  runtimeBySessionId: {},
};
export const chatActiveRuntimeBySessionId = derived(chatStore, ($chatStore) => {
  const scopeKey = $chatStore.activeChatScopeKey;
  if (!scopeKey) {
    if (lastRuntimeInput?.scopeKey === null && lastRuntimeInput !== null) {
      return lastRuntimeOutput;
    }
    lastRuntimeInput = { scopeKey: null, mapRef: null };
    lastRuntimeOutput = { scopeKey: null, runtimeBySessionId: {} };
    return lastRuntimeOutput;
  }
  const runtimeBySessionId = $chatStore.workspaces[scopeKey]?.runtimeBySessionId ?? {};
  if (
    lastRuntimeInput &&
    lastRuntimeInput.scopeKey === scopeKey &&
    lastRuntimeInput.mapRef === runtimeBySessionId
  ) {
    return lastRuntimeOutput;
  }
  lastRuntimeInput = { scopeKey, mapRef: runtimeBySessionId };
  lastRuntimeOutput = { scopeKey, runtimeBySessionId: { ...runtimeBySessionId } };
  return lastRuntimeOutput;
});

export type ChatSessionSubtitle = {
  display: string;
  full: string;
};

/**
 * Per-session subtitle map for the active workspace. Referential stability:
 * the `Map` is only rebuilt when the underlying `threadsBySessionId` reference
 * changes (the workspace slice replaces it on real thread mutations). Returns a
 * stable empty `Map` when there is no active scope/workspace.
 */
let lastSubtitleInput: { scopeKey: ChatScopeKey | null; threadsRef: unknown } | null = null;
let lastSubtitleOutput: Map<string, ChatSessionSubtitle> = EMPTY_SUBTITLE_MAP;
export const chatSessionSubtitleById = derived(chatStore, ($chatStore) => {
  const scopeKey = $chatStore.activeChatScopeKey;
  if (!scopeKey) {
    return EMPTY_SUBTITLE_MAP;
  }

  const workspace = $chatStore.workspaces[scopeKey];
  if (!workspace) {
    return EMPTY_SUBTITLE_MAP;
  }

  const threadsRef = workspace.threadsBySessionId;
  if (
    lastSubtitleInput &&
    lastSubtitleInput.scopeKey === scopeKey &&
    lastSubtitleInput.threadsRef === threadsRef
  ) {
    return lastSubtitleOutput;
  }

  const subtitles = new Map<string, ChatSessionSubtitle>();
  for (const [sessionId, thread] of Object.entries(threadsRef)) {
    const display = deriveSessionSubtitleFromThread(thread);
    const full = thread ? firstAssistantMessageContent(thread.messages) : null;
    if (display && full) {
      subtitles.set(sessionId, { display, full });
    }
  }
  lastSubtitleInput = { scopeKey, threadsRef };
  lastSubtitleOutput = subtitles;
  return subtitles;
});

export const chatActiveSessionId = derived(chatStore, ($chatStore) => activeSessionId($chatStore));
