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
  /**
   * Expanded project-tree folder paths persisted per workspace so the tree
   * reopens to the same state across sessions. Absolute, normalized paths.
   */
  expandedProjectTreePaths: string[];
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

export type ContextId = "notepad" | `ws-${number}`;

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
