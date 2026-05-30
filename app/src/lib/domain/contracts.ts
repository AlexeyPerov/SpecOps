import type { ActiveThemeRef, CustomThemeRecord } from "../services/themeStore";

export interface DiskFingerprint {
  mtimeMs: number;
  sizeBytes: number;
}

export interface DocumentIdentity {
  id: string;
  filePath: string | null;
}

export type MarkdownViewMode = "edit" | "split" | "preview";

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
  markdownViewMode: MarkdownViewMode;
}

export interface WindowBounds {
  width: number;
  height: number;
  x: number;
  y: number;
  maximized: boolean;
}

export interface FileTabState {
  id: string;
  kind: "file";
  documentId: string;
  pinned: boolean;
}

export interface AgentTabState {
  id: string;
  kind: "agent";
  agentId: string;
  pinned: boolean;
}

export type TabState = FileTabState | AgentTabState;

export function isFileTab(tab: TabState): tab is FileTabState {
  return tab.kind === "file";
}

export function isAgentTab(tab: TabState): tab is AgentTabState {
  return tab.kind === "agent";
}

export function createFileTab(id: string, documentId: string, pinned = false): FileTabState {
  return { id, kind: "file", documentId, pinned };
}

export function createAgentTab(id: string, agentId: string, pinned = false): AgentTabState {
  return { id, kind: "agent", agentId, pinned };
}

/** Restores legacy session tabs that omit `kind`. */
export function normalizeTabState(
  tab: TabState | (Omit<FileTabState, "kind"> & { kind?: unknown; agentId?: unknown }),
): TabState {
  if (tab.kind === "agent" && typeof tab.agentId === "string") {
    return {
      id: tab.id,
      kind: "agent",
      agentId: tab.agentId,
      pinned: tab.pinned ?? false,
    };
  }
  if ("documentId" in tab && typeof tab.documentId === "string") {
    return createFileTab(tab.id, tab.documentId, tab.pinned ?? false);
  }
  throw new Error(`Invalid tab state: ${tab.id}`);
}

export function tabDocumentId(
  tab: TabState | (Omit<FileTabState, "kind"> & { kind?: unknown; agentId?: unknown }) | undefined,
): string | null {
  if (!tab) {
    return null;
  }
  const normalized = normalizeTabState(tab);
  return isFileTab(normalized) ? normalized.documentId : null;
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

/** Settings-gated development provider; disabled by default (see M5-3). */
export interface DebugProviderSettings {
  enabled: boolean;
  simulationSeed: number | null;
  delayMsMin: number;
  delayMsMax: number;
  chunkCharsMin: number;
  chunkCharsMax: number;
  failureProbability: number;
  failureMessage: string;
  includeDiagnostics: boolean;
}

/** Product GLM provider settings (API key stored separately; see glmSecretsStore). */
export interface GlmProviderSettings {
  enabled: boolean;
  baseUrl: string;
  modelId: string;
}

export interface AppThemeState {
  activeTheme: ActiveThemeRef;
  customThemes: CustomThemeRecord[];
}

export interface AppSettingsState {
  statusBarVisible: boolean;
  externalFiles: ExternalFilesSettings;
  decoratePlaintextSymbols: boolean;
  hideActivityRailWhenNotepadOnly: boolean;
  debugProvider: DebugProviderSettings;
  glmProvider: GlmProviderSettings;
  /** In-memory only; loaded from glmSecretsStore, never written to settings.json. */
  glmApiKey: string;
}

export type AppCommandId =
  | "app.toggleThemePane"
  | "app.toggleSettings"
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
  binding?: CommandBinding;
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
  agentId: string;
  threadId: string;
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

/** One persisted agent conversation (messages + per-agent settings). */
export interface ChatThreadSnapshot {
  metadata: ChatThreadMetadata;
  messages: ChatMessage[];
}

export interface AgentIndexEntry {
  id: string;
  title: string;
  lastUsedAt: string;
  /** Session-only drafts are not written to disk until first user message. */
  isDraft?: boolean;
}

/** Per-workspace agent list only — no conversation payload. */
export interface WorkspaceAgentsIndexSnapshot {
  version: 1;
  agents: AgentIndexEntry[];
}

/** Versioned on-disk envelope for a single agent thread file. */
export interface ChatAgentThreadFileSnapshot {
  version: 1;
  thread: ChatThreadSnapshot;
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
