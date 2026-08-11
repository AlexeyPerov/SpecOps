import type { WorkspaceAccessStatus } from "../../ai/capabilities";
import { WorkspaceAccessReason } from "../../ai/capabilities";
import type {
  ChatThreadSnapshot,
  SessionIndexEntry,
} from "../../domain/contracts";

// Re-export so consumers of the chatStore types can import SessionIndexEntry
// alongside the other chat-store types without reaching into domain/contracts.
export type { SessionIndexEntry };

/**
 * Chat persistence/runtime scope key. Workspace sessions are scoped by their
 * normalized workspace root path.
 */
export type ChatScopeKey = string;

/** Per-workspace session index, threads, and ephemeral runtime. */
export interface WorkspaceSessionsState {
  activeSessionId: string | null;
  sessionIndex: SessionIndexEntry[];
  threadsBySessionId: Record<string, ChatThreadSnapshot | null>;
  runtimeBySessionId: Record<string, ChatThreadRuntimeState>;
}

export interface ChatStoreState {
  /** Active chat scope: normalized workspace root path. */
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
