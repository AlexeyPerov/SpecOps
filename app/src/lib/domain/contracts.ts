export type ThemeMode = "light" | "dark";
export type AccentOption = "blue" | "violet" | "green";

export interface DocumentIdentity {
  id: string;
  filePath: string | null;
}

export interface DocumentState extends DocumentIdentity {
  title: string;
  content: string;
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
  | "view.toggleTheme"
  | "file.new";

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
}
