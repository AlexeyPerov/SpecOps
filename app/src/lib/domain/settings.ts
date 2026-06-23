import type { ActiveThemeRef, CustomThemeRecord } from "../services/themeStore";
import type { ChatModesSettings, ChatProviderId } from "./chat";
import type { CommandBindingOverrides } from "./commands";

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

export interface AppThemeState {
  activeTheme: ActiveThemeRef;
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

export type OpencodeHealthStatus = "unknown" | "checking" | "healthy" | "degraded" | "error";

export type OpencodeHealthSource = "sidecar" | "url" | null;

export interface OpencodeHealthState {
  status: OpencodeHealthStatus;
  source: OpencodeHealthSource;
  checkedAt: string | null;
  lastErrorMessage: string | null;
}

/**
 * Agent feedback events that can fire sound and/or OS notifications
 * (phase-3.5/questions.md Q9). Kept in one place so sound and OS settings share
 * the same event vocabulary.
 */
export type NotificationEventId = "agentDone" | "permission" | "question" | "error";

/** The full set of feedback events, in display order. */
export const NOTIFICATION_EVENT_IDS: readonly NotificationEventId[] = [
  "agentDone",
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
  hideActivityRailWhenNotepadOnly: boolean;
  opencode: OpencodeSettings;
  chatHttp: ChatHttpSettings;
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
