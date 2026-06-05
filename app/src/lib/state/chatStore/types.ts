import type { WorkspaceAccessStatus } from "../../ai/capabilities";
import { WorkspaceAccessReason } from "../../ai/capabilities";
import type {
  AgentIndexEntry,
  ChatThreadSnapshot,
  ContextId,
  ProviderModelCatalogs,
} from "../../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID } from "../../domain/contracts";

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

/** Per-workspace agent index, threads, and ephemeral runtime. */
export interface WorkspaceAgentsState {
  activeAgentId: string | null;
  agentIndex: AgentIndexEntry[];
  threadsByAgentId: Record<string, ChatThreadSnapshot | null>;
  runtimeByAgentId: Record<string, ChatThreadRuntimeState>;
}

export interface ChatStoreState {
  /** Active chat scope: normalized workspace root path or `chat-http`. */
  activeChatScopeKey: ChatScopeKey | null;
  workspaces: Record<string, WorkspaceAgentsState>;
  accessByWorkspace: Record<string, ChatAccessState>;
}

export interface ChatTurnError {
  message: string;
  code?: string;
}

/** Ephemeral per-agent chat runtime; not persisted to disk. */
export interface ChatThreadRuntimeState {
  isGenerating: boolean;
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

export interface ChatProviderSwitchOptions {
  debugProviderEnabled: boolean;
  providerModelCatalogs: ProviderModelCatalogs;
}

export interface ChatModelSwitchOptions {
  providerModelCatalogs: ProviderModelCatalogs;
}
