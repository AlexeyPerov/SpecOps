import type { WorkspaceAccessStatus } from "../../ai/capabilities";
import { WorkspaceAccessReason } from "../../ai/capabilities";
import type {
  AgentIndexEntry,
  ChatThreadSnapshot,
  ProviderModelCatalogs,
} from "../../domain/contracts";

/** Per-workspace agent index, threads, and ephemeral runtime. */
export interface WorkspaceAgentsState {
  activeAgentId: string | null;
  agentIndex: AgentIndexEntry[];
  threadsByAgentId: Record<string, ChatThreadSnapshot | null>;
  runtimeByAgentId: Record<string, ChatThreadRuntimeState>;
}

export interface ChatStoreState {
  /**
   * Active chat scope key; currently a normalized workspace root path.
   * Planned migration path: align this key with `ContextId` (phase 2+).
   */
  activeWorkspaceRoot: string | null;
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
