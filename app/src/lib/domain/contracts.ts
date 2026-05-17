export type ThemeMode = "light" | "dark";
export type AccentOption = "blue" | "violet" | "green";

export interface DocumentIdentity {
  id: string;
  filePath: string | null;
}

export interface DocumentState extends DocumentIdentity {
  title: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  language: "plaintext" | "markdown";
  encoding: "utf-8";
  lineEnding: "lf" | "crlf";
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
}

export interface AppSettingsState {
  themeMode: ThemeMode;
  accent: AccentOption;
  statusBarVisible: boolean;
}

export type AppCommandId =
  | "app.toggleSettingsPane"
  | "app.newWindow"
  | "app.toggleFindReplace"
  | "app.toggleGoTo"
  | "view.toggleTheme"
  | "view.toggleMarkdownPreview"
  | "view.toggleDiffPreview"
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.saveAll"
  | "file.rename"
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
  recentFiles: string[];
  editor: AppDomainState["editor"];
}

export interface AppSessionSnapshot {
  version: 1;
  updatedAt: string;
  lastActiveWindowId: string;
  windows: Record<string, WindowSessionSnapshot>;
}
