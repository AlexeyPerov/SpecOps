/**
 * Types for the AppShellHost subsystem.
 *
 * `AppShellHost.svelte` owns the handler/controller factories that used to
 * allocate at `+page.svelte` init (L3). The host exposes an imperative
 * `AppShellHostApi` (captured by the page via `bind:this`) so the page's
 * `onMount` and retained `$effect`s can call into handlers without the page
 * constructing the factory bundles itself.
 */

import type { ContextId } from "../../domain/contracts";

export interface AppShellHostApi {
  runCommand: (commandId: string) => void | Promise<void>;
  handleKeydown: (event: KeyboardEvent) => void;
  onTabActivated: (tabId: string) => Promise<void>;
  openAndActivatePath: (
    path: string,
    options?: { revealInTree?: boolean },
  ) => Promise<void>;
  consumeOpenedPaths: () => string[];
  restoreWorkspaceSession: (
    workspaceRoot: string,
    options?: { skipOpencodeReconcile?: boolean },
  ) => Promise<void>;
  ensureChatHttpSessionTab: () => void;
  loadProjectTreeRoot: () => Promise<void>;
  notifyProjectTreeFilesystemChange: (
    path: string,
    kind: import("../../services/fileWatcher").FileWatcherEventKind,
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
  ) => Promise<unknown[]>;
  handleOpenExternalSession: (sessionId: string) => Promise<void>;
}

/** Bound host instance captured via `bind:this`. */
export interface AppShellHostBound {
  api: AppShellHostApi;
}
