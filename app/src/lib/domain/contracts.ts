import type { AppTheme } from "../styles/themes";

export interface DiskFingerprint {
  mtimeMs: number;
  sizeBytes: number;
}

export interface DocumentIdentity {
  id: string;
  filePath: string | null;
}

export interface DocumentState extends DocumentIdentity {
  title: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  language: string;
  encoding: "utf-8";
  lineEnding: "lf" | "crlf";
  diskFingerprint: DiskFingerprint | null;
  dismissedFingerprint: DiskFingerprint | null;
  fileMissing: boolean;
  scrollTop: number;
}

export interface WindowBounds {
  width: number;
  height: number;
  x: number;
  y: number;
  maximized: boolean;
}

export interface TabState {
  id: string;
  documentId: string;
  pinned: boolean;
}

export interface SessionState {
  selectedTabId: string | null;
  openTabs: TabState[];
  lastActiveWindowId: string;
  windowBounds: WindowBounds | null;
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

export interface ExternalFilesSettings {
  watchExternalChanges: boolean;
  autoReloadCleanFiles: boolean;
  checkOnWindowFocus: boolean;
  checkOnTabActivate: boolean;
}

export interface AppSettingsState {
  theme: AppTheme;
  statusBarVisible: boolean;
  externalFiles: ExternalFilesSettings;
  decoratePlaintextSymbols: boolean;
  hideActivityRailWhenNotepadOnly: boolean;
}

export type AppCommandId =
  | "app.toggleSettingsPane"
  | "app.newWindow"
  | "app.toggleFindReplace"
  | "app.toggleGoTo"
  | "view.cycleTheme"
  | "view.toggleMarkdownPreview"
  | "view.toggleDiffPreview"
  | "file.new"
  | "file.open"
  | "file.openRecent"
  | "file.clearRecentFiles"
  | "file.openAllInFolder"
  | "file.save"
  | "file.saveAs"
  | "file.saveAll"
  | "file.rename"
  | "file.reloadFromDisk"
  | "tab.close"
  | "tab.moveToNewWindow"
  | "tab.next"
  | "tab.previous"
  | "edit.undo"
  | "edit.redo"
  | "edit.indent"
  | "edit.outdent"
  | "edit.moveLineUp"
  | "edit.moveLineDown"
  | "edit.duplicateLine"
  | "edit.joinLines"
  | "view.toggleWrap"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "workspace.add"
  | "workspace.close";

export interface CommandBinding {
  mac: string;
  windows: string;
}

export interface CommandDefinition {
  id: AppCommandId;
  label: string;
  menuPath: string;
  binding: CommandBinding;
}

export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export interface DiagnosticEvent {
  level: DiagnosticLevel;
  message: string;
  source: "frontend" | "backend";
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatModeId = "ask" | "review";

export type ChatProviderId = "glm" | "cursor" | "debug";

/** MVP product providers; Debug is dev-only and settings-gated (see M5-3). */
export const PRODUCT_CHAT_PROVIDER_IDS = ["glm", "cursor"] as const satisfies readonly ChatProviderId[];

/**
 * System-only marker events persisted in chat history.
 * Start with provider switching and expand as system event needs grow.
 */
export type ChatSystemEvent = {
  type: "provider-switched";
  fromProvider: ChatProviderId | null;
  toProvider: ChatProviderId;
};

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  systemEvent?: ChatSystemEvent;
}

export interface ChatThreadMetadata {
  mode: ChatModeId;
  provider: ChatProviderId;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  /** Number of FIFO compaction events applied to this thread. */
  compactionCount?: number;
  /** ISO timestamp of the most recent compaction event. */
  lastCompactedAt?: string;
  /** Cumulative count of messages removed by compaction (for UI indicators). */
  compactedMessageCount?: number;
}

/**
 * In MVP, chat is one thread per workspace.
 * `ChatThreadSnapshot` represents that single per-workspace thread.
 */
export interface ChatThreadSnapshot {
  metadata: ChatThreadMetadata;
  messages: ChatMessage[];
}

/**
 * Versioned on-disk envelope for workspace chat persistence.
 * Keep a single `thread` to enforce one-thread-per-workspace invariant.
 */
export interface ChatThreadFileSnapshot {
  version: 1;
  thread: ChatThreadSnapshot | null;
}

export interface OpenFileOwner {
  windowId: string;
  documentId: string;
}

export type OpenFileRegistry = Record<string, OpenFileOwner>;

export interface AppDomainState {
  contexts: WindowContextState;
  /**
   * Active context mirrors for legacy consumers.
   * Keep in sync with `contexts[activeContextId]`.
   */
  documents: DocumentState[];
  session: SessionState;
  settings: AppSettingsState;
  recentFiles: string[];
  editor: {
    cursorLine: number;
    cursorColumn: number;
    zoomPercent: number;
    wrapLines: boolean;
    findReplaceOpen: boolean;
    goToOpen: boolean;
    previewMode: "editor" | "markdown" | "diff";
    projectPanelCollapsed: boolean;
  };
}

export interface WindowSessionSnapshot {
  activeContextId: ContextId;
  notepad: ContextSnapshot;
  workspaces: WorkspaceEntry[];
  editorPreferences: Pick<
    AppDomainState["editor"],
    "zoomPercent" | "wrapLines" | "projectPanelCollapsed"
  >;
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
