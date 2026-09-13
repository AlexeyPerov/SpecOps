/**
 * Types for the AppShellHost subsystem.
 *
 * `AppShellHost.svelte` owns the handler/controller factories that used to
 * allocate at `+page.svelte` init (L3). The host exposes an imperative
 * `AppShellHostApi` (captured by the page via `bind:this`) so the page's
 * `onMount` and retained `$effect`s can call into handlers without the page
 * constructing the factory bundles itself.
 */

import type { AppCommandId, ContextId } from "../domain/contracts";
import type { FileWatcherEventKind } from "../services/fileWatcher";
import type { WorkspaceAgentSessionDetails } from "../ai/backends/workspaceAgentBackend";

export interface AppShellHostApi {
  runCommand: (commandId: AppCommandId) => void;
  handleKeydown: (event: KeyboardEvent) => void;
  onTabActivated: (tabId: string) => Promise<void>;
  openAndActivatePath: (path: string) => Promise<void>;
  openDroppedPathsInContext: (paths: string[], contextId: ContextId) => Promise<void>;
  consumeOpenedPaths: (paths: string[]) => Promise<void>;
  restoreWorkspaceSession: (
    workspaceRoot: string,
    options?: { skipOpencodeReconcile?: boolean; preferCachedIndex?: boolean },
  ) => Promise<void>;
  ensureChatHttpSessionTab: () => void | Promise<void>;
  loadProjectTreeRoot: () => Promise<void>;
  notifyProjectTreeFilesystemChange: (
    path: string,
    kind?: FileWatcherEventKind,
  ) => void;
  setupLayoutObserver: () => void;
  disconnectLayoutObserver: () => void;
  clearUntitledTitleDebounceTimer: () => void;
  handleActiveContextSwitch: (contextId: ContextId) => void;
  openSettingsFromContextMenu: (workspaceId: ContextId) => void;
  openVersionControlFromContextMenu: (workspaceId: ContextId) => void;
  canFitMarkdownSplit: () => boolean;
  toggleConsole: () => void;
  applyResponsiveLayoutRules: () => void;
  setMarkdownViewMode: (mode: "edit" | "split" | "preview") => void;
  handleListWorkspaceSessions: (
    options?: { search?: string; limit?: number },
  ) => Promise<WorkspaceAgentSessionDetails[]>;
  handleOpenExternalSession: (sessionId: string, title?: string) => Promise<void>;
}

/** Bound host instance captured via `bind:this`. */
export interface AppShellHostBound {
  api: AppShellHostApi;
}
