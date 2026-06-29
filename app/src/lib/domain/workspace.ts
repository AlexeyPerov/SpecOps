import type { EditorLayout } from "./editorLayout";
import type { DocumentState } from "./document";

export interface WindowBounds {
  width: number;
  height: number;
  x: number;
  y: number;
  maximized: boolean;
}

export interface WorkspaceLayoutState {
  projectPanelWidthPx: number;
  sessionsSidebarWidthPx: number;
  projectPanelCollapsed: boolean;
  sessionsSidebarCollapsed: boolean;
}

/**
 * Per-context editor session state.
 *
 * Tabs live inside an `editorLayout` (split view / layout groups): a list of
 * panes, each with its own tab strip and selected tab, plus a `slots` grid
 * descriptor. The flat `openTabs`/`selectedTabId` fields were replaced by the
 * layout model (single-pane = one pane). Helpers in `domain/editorLayout.ts`
 * (getSessionTabs/getSessionSelectedTabId/...) reach the active pane.
 *
 * `layout` (WorkspaceLayoutState) is the unrelated, long-standing per-workspace
 * panel-layout field (project panel / sessions sidebar sizes & collapse state).
 */
export interface SessionState {
  editorLayout: EditorLayout;
  lastActiveWindowId: string;
  windowBounds: WindowBounds | null;
  /** Last focused workspace session in this context; persisted in session snapshot. */
  lastActiveSessionId?: string | null;
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
