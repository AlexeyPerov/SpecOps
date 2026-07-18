import type { WorkspaceAccessStatus } from "../../ai/capabilities";
import { WorkspaceAccessReason } from "../../ai/capabilities";
import type {
  ChatThreadSnapshot,
  ContextId,
  ProviderModelCatalogs,
  SessionIndexEntry,
} from "../../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID } from "../../domain/contracts";

// Re-export so consumers of the chatStore types can import SessionIndexEntry
// alongside the other chat-store types without reaching into domain/contracts.
export type { SessionIndexEntry };

/** Chat persistence/runtime scope: normalized workspace root or a chat context id. */
export type ChatScopeKey = typeof CHAT_HTTP_CONTEXT_ID | string;

export function isChatContextScopeKey(key: string): key is typeof CHAT_HTTP_CONTEXT_ID {
  return key === CHAT_HTTP_CONTEXT_ID;
}

export function isWorkspaceChatScopeKey(key: ChatScopeKey): key is string {
  return !isChatContextScopeKey(key);
}

/** Context ids that map to a fixed chat scope key (phase 2 M1: chat-http only). */
export function chatScopeKeyForContextId(contextId: ContextId): ChatScopeKey | null {
  if (contextId === CHAT_HTTP_CONTEXT_ID) {
    return CHAT_HTTP_CONTEXT_ID;
  }
  return null;
}

/** Per-workspace session index, threads, and ephemeral runtime. */
export interface WorkspaceSessionsState {
  activeSessionId: string | null;
  sessionIndex: SessionIndexEntry[];
  threadsBySessionId: Record<string, ChatThreadSnapshot | null>;
  runtimeBySessionId: Record<string, ChatThreadRuntimeState>;
}

export interface ChatStoreState {
  /** Active chat scope: normalized workspace root path or `chat-http`. */
  activeChatScopeKey: ChatScopeKey | null;
  workspaces: Record<string, WorkspaceSessionsState>;
  accessByWorkspace: Record<string, ChatAccessState>;
}

export interface ChatTurnError {
  message: string;
  code?: string;
}

/** Ephemeral per-session chat runtime; not persisted to disk. */
export interface ChatThreadRuntimeState {
  isGenerating: boolean;
  isWaitingForPermission: boolean;
  isWaitingForQuestion: boolean;
  lastFailedTurnId: string | null;
  lastError: ChatTurnError | null;
  activeTurnId: string | null;
}

export interface ChatAccessState {
  status: WorkspaceAccessStatus;
  reason: WorkspaceAccessReason;
  message: string;
  recoveryHint?: string;
  checkedAt: string;
}

export interface SwitchThreadProviderResult {
  switched: boolean;
  message?: string;
}

export interface SwitchThreadModelResult {
  switched: boolean;
  message?: string;
}

export interface SwitchThreadConnectionResult {
  switched: boolean;
  message?: string;
}

export interface ChatProviderSwitchOptions {
  providerSettings: import("../../domain/contracts").AppProviderSettings;
  providerModelCatalogs: ProviderModelCatalogs;
}

export interface ChatModelSwitchOptions {
  providerSettings: import("../../domain/contracts").AppProviderSettings;
  providerModelCatalogs: ProviderModelCatalogs;
}
