import type { DocumentState, TabState } from "./document";

export interface WindowBounds {
  width: number;
  height: number;
  x: number;
  y: number;
  maximized: boolean;
}

export interface WorkspaceLayoutState {
  projectPanelWidthPx: number;
  agentsSidebarWidthPx: number;
  projectPanelCollapsed: boolean;
  agentsSidebarCollapsed: boolean;
}

export interface SessionState {
  selectedTabId: string | null;
  openTabs: TabState[];
  lastActiveWindowId: string;
  windowBounds: WindowBounds | null;
  /** Last focused agent in this workspace context; persisted in session snapshot. */
  lastActiveAgentId?: string | null;
  /** Per-workspace panel layout; persisted in session snapshot. */
  layout?: WorkspaceLayoutState;
}

export const CHAT_HTTP_CONTEXT_ID = "chat-http" as const;
export const CHAT_CLOUD_CONTEXT_ID = "chat-cloud" as const;

export type ContextId =
  | "notepad"
  | typeof CHAT_HTTP_CONTEXT_ID
  | typeof CHAT_CLOUD_CONTEXT_ID
  | `ws-${number}`;

export interface ContextSnapshot {
  documents: DocumentState[];
  session: SessionState;
}

export interface WorkspaceContext {
  id: ContextId;
  rootPath: string;
  snapshot: ContextSnapshot;
}

export interface WorkspaceEntry {
  id: ContextId;
  rootPath: string;
  snapshot: ContextSnapshot;
}

export interface WindowContextState {
  activeContextId: ContextId;
  notepad: ContextSnapshot;
  /** Dedicated chat-http runtime context snapshot (no workspace root). */
  chatHttp: ContextSnapshot;
  /**
   * Reserved for phase-2 context persistence.
   * Phase 1 adds type foundations only (no rail UI and no persisted usage yet).
   */
  chatCloud?: ContextSnapshot;
  workspaces: WorkspaceEntry[];
}

export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export interface DiagnosticEvent {
  level: DiagnosticLevel;
  message: string;
  source: "frontend" | "backend";
  metadata?: Record<string, unknown>;
  timestamp: string;
}
