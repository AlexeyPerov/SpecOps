import type { ActiveThemeRef, CustomThemeRecord } from "../services/themeStore";
import type { ChatModesSettings, ChatProviderId } from "./chat";
import type { CommandBindingOverrides } from "./commands";
import type { MarkdownViewMode } from "./document";

export interface ExternalFilesSettings {
  watchExternalChanges: boolean;
  autoReloadCleanFiles: boolean;
  checkOnWindowFocus: boolean;
  checkOnTabActivate: boolean;
  /** Max size (bytes) for non-image binary files opened as text in the editor. */
  maxBinaryOpenAsTextBytes: number;
  /** Max size (bytes) for opening text-editor files without a confirmation step. */
  maxOpenWithoutConfirmBytes: number;
}

/** Shared toggle for provider-scoped settings blocks. */
export interface ProviderSettingsBase {
  enabled: boolean;
}

/** Settings-gated development provider; disabled by default (see M5-3). */
export interface DebugProviderSettings extends ProviderSettingsBase {
  simulationSeed: number | null;
  delayMsMin: number;
  delayMsMax: number;
  chunkCharsMin: number;
  chunkCharsMax: number;
  failureProbability: number;
  failureMessage: string;
  includeDiagnostics: boolean;
}

/** OpenAI-compatible HTTP connection transport settings (API key stored separately). */
export interface HttpConnectionSettings extends ProviderSettingsBase {
  baseUrl: string;
}

/** Settings-managed model list and default model for one chat provider. */
export interface ProviderModelCatalog {
  modelIds: string[];
  defaultModelId: string;
}

/** Provider-scoped model catalogs keyed by chat provider id. */
export type ProviderModelCatalogs = Partial<Record<ChatProviderId, ProviderModelCatalog>>;

/** One named OpenAI-compatible HTTP provider connection. */
export interface HttpConnection extends HttpConnectionSettings {
  id: string;
  label: string;
  modelCatalog: ProviderModelCatalog;
}

/** Per-provider settings types; extend this map when adding a configured provider. */
export interface ProviderSettingsById {
  httpConnections?: HttpConnection[];
  /** Preferred HTTP connection id. Falls back to first configured connection when missing/stale. */
  defaultConnectionId?: string;
  debugChat: DebugProviderSettings;
  debugWorkspace: DebugProviderSettings;
  /** Legacy singleton HTTP settings kept during M4 migration. */
  http: HttpConnectionSettings;
}

/** In-app and persisted bundle of provider-specific settings (excludes API keys). */
export type AppProviderSettings = ProviderSettingsById;

/**
 * Theme mode. `auto` follows the OS `prefers-color-scheme` media query and
 * switches between the user's chosen {@link AppThemeState.darkTheme} and
 * {@link AppThemeState.lightTheme}. `manual` pins a single theme
 * ({@link AppThemeState.manualTheme}) regardless of OS.
 */
export type ThemeMode = "auto" | "manual";

export interface AppThemeState {
  mode: ThemeMode;
  /** Applied when the effective mode resolves to dark (mode=auto with OS in dark). */
  darkTheme: ActiveThemeRef;
  /** Applied when the effective mode resolves to light (mode=auto with OS in light). */
  lightTheme: ActiveThemeRef;
  /** Applied when mode=manual, regardless of the OS color scheme. */
  manualTheme: ActiveThemeRef;
  customThemes: CustomThemeRecord[];
}

/** Console and file logging preferences. */
export interface LogSettings {
  /** When enabled, logs full provider request and response payloads. */
  verboseProviderLogging: boolean;
  /** When enabled, the bottom logs panel can be opened from the status bar. */
  canOpenLogsPanel: boolean;
}

/**
 * Font-size scales for the three rendered surfaces. Values are percentages of
 * the 13px base (100 = default). M6-T2 covers size only — font families are
 * intentionally not configurable (see phase-3.5/questions.md Q9).
 */
export interface FontSettings {
  /** UI chrome font scale (body, panels, status bar). */
  uiScale: number;
  /** Code editor font scale (composed with editor zoom). */
  editorScale: number;
  /** Chat message / prose font scale. */
  chatScale: number;
}

export type OpencodeTransportMode = "sidecar" | "url";

export interface OpencodeSettings {
  enabled: boolean;
  mode: OpencodeTransportMode;
  /** Remote OpenCode server base URL used when mode is `url`. */
  baseUrl: string;
  /**
   * Local sidecar port used when mode is `sidecar`. M14-T2 introduces this as
   * an explicit field so users can pick a free port (the prior hard-coded
   * `4096` lived in Rust). Validated to 1024–65535; missing or out-of-range
   * values normalize to {@link defaultOpencodeSettings.sidecarPort} (4096).
   */
  sidecarPort: number;
}

/**
 * Master toggle for the experimental `chat-http` context (phase-3.5 M13).
 *
 * Disabled by default. When false, the activity-rail Chat button is hidden
 * and the Settings → Dev → Chats subtree (Providers, Chat modes, Debug
 * Provider) is removed from the sidebar; persisted provider configuration
 * is untouched.
 */
export interface ChatHttpSettings {
  enabled: boolean;
}

/**
 * Master and behavioral toggles for system-git version control integration.
 *
 * When {@link GitIntegrationSettings.enabled} is false, no git subprocesses
 * run and Version Control UI entry points are hidden.
 */
export interface GitIntegrationSettings {
  /** Master switch — when false, no git subprocesses or VC UI. */
  enabled: boolean;
  /** Autosave dirty editor buffers before VC mutations. */
  autosaveBeforeOperations: boolean;
  /** Use system git for project-tree M/A/D badges. */
  showProjectTreeBadges: boolean;
  /** Load git status cells in Workspace Manager. */
  showWorkspaceManagerGitColumn: boolean;
}

export type OpencodeHealthStatus = "unknown" | "checking" | "healthy" | "degraded" | "error";

export type OpencodeHealthSource = "sidecar" | "url" | null;

export interface OpencodeHealthState {
  status: OpencodeHealthStatus;
  source: OpencodeHealthSource;
  checkedAt: string | null;
  lastErrorMessage: string | null;
}

/**
 * Workspace session feedback events that can fire sound and/or OS
 * notifications (phase-3.5/questions.md Q9). Kept in one place so sound and OS
 * settings share the same event vocabulary.
 */
export type NotificationEventId = "sessionDone" | "permission" | "question" | "error";

/** The full set of feedback events, in display order. */
export const NOTIFICATION_EVENT_IDS: readonly NotificationEventId[] = [
  "sessionDone",
  "permission",
  "question",
  "error",
];

/** Per-event sound configuration (M6-T4). */
export interface SoundSettings {
  /** Master sound enable; when false no sound plays for any event. */
  enabled: boolean;
  /** Volume gain 0–100 applied to every tone. */
  volume: number;
  /** Per-event enable flags. */
  events: Record<NotificationEventId, boolean>;
}

/** Per-event OS notification configuration (M6-T5). */
export interface OsNotificationSettings {
  /** Master OS notification enable; when false no system notification fires. */
  enabled: boolean;
  /** Per-event enable flags. */
  events: Record<NotificationEventId, boolean>;
}

export interface AppSettingsState {
  statusBarVisible: boolean;
  externalFiles: ExternalFilesSettings;
  decoratePlaintextSymbols: boolean;
  /**
   * When true, text/code editors render a scaled minimap column on the right
   * side of the CodeMirror surface. Global editor preference (not per-document).
   */
  showMinimap: boolean;
  /**
   * When true, text/code editors show a fold gutter beside line numbers.
   * Fold commands remain available when the gutter is hidden. Default on —
   * the gutter adds ~14px and is therefore user-toggleable.
   */
  showFoldGutter: boolean;
  /**
   * Initial view mode applied to newly opened markdown documents. Each
   * document remembers its own mode after open; this only seeds the first.
   */
  defaultMarkdownViewMode: MarkdownViewMode;
  /**
   * When true, files outside the active workspace open in Notepad and
   * workspace files opened from a workspace migrate out of Notepad. When false
   * (default), files open in whichever context is active.
   */
  restrictFilesToContext: boolean;
  opencode: OpencodeSettings;
  chatHttp: ChatHttpSettings;
  gitIntegration: GitIntegrationSettings;
  opencodeHealth: OpencodeHealthState;
  commandBindingOverrides: CommandBindingOverrides;
  logSettings: LogSettings;
  chatModes: ChatModesSettings;
  providerSettings: AppProviderSettings;
  providerModelCatalogs: ProviderModelCatalogs;
  fontSettings: FontSettings;
  soundSettings: SoundSettings;
  osNotificationSettings: OsNotificationSettings;
  /** In-memory only; loaded from providerSecretsStore, never written to settings.json. */
  providerApiKeys: Partial<Record<string, string>>;
}
