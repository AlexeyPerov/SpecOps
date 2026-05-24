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
  | "view.zoomReset";

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

export interface OpenFileOwner {
  windowId: string;
  documentId: string;
}

export type OpenFileRegistry = Record<string, OpenFileOwner>;

export interface AppDomainState {
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
  };
}

export interface WindowSessionSnapshot {
  documents: DocumentState[];
  session: SessionState;
  editor: AppDomainState["editor"];
}

export interface AppSessionSnapshot {
  version: 1;
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
