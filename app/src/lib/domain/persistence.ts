import type { AppSettingsState, AppThemeState } from "./settings";
import type { ContextSnapshot, ContextId, WorkspaceEntry, WindowContextState } from "./workspace";

export interface OpenFileOwner {
  windowId: string;
  documentId: string;
}

export type OpenFileRegistry = Record<string, OpenFileOwner>;

export interface AppDomainState {
  contexts: WindowContextState;
  settings: AppSettingsState;
  theme: AppThemeState;
  recentFiles: string[];
  editor: {
    cursorLine: number;
    cursorColumn: number;
    zoomPercent: number;
    wrapLines: boolean;
    findReplaceOpen: boolean;
    goToOpen: boolean;
    previewMode: "editor" | "markdown" | "diff";
  };
}

export interface WindowSessionSnapshot {
  activeContextId: ContextId;
  notepad: ContextSnapshot;
  /** Reserved for phase-2 persistence. */
  chatHttp?: ContextSnapshot;
  /** Reserved for phase-2 persistence. */
  chatCloud?: ContextSnapshot;
  workspaces: WorkspaceEntry[];
  editorPreferences: Pick<AppDomainState["editor"], "zoomPercent" | "wrapLines">;
}

export interface AppSessionSnapshot {
  /** Session v2. v1 snapshots are intentionally not migrated. */
  version: 2;
  updatedAt: string;
  lastActiveWindowId: string;
  openFileRegistry: OpenFileRegistry;
  recentFiles: string[];
  windows: Record<string, WindowSessionSnapshot>;
}

export interface RestoredWindowSession {
  snapshot: WindowSessionSnapshot;
  recentFiles: string[];
}
