import type { ActiveThemeRef, CustomThemeRecord } from "../services/themeStore";
import type { MarkdownSnippetSettings } from "./snippets";
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
  /**
   * When enabled, performance timing samples are captured into a bounded
   * in-memory ring regardless of console level, for a downloadable report.
   * Off by default; the ring is a no-op allocation-wise when disabled.
   */
  collectPerfLogs: boolean;
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

/**
 * Master toggle for the experimental workspace-sessions backend (OpenCode).
 *
 * Disabled by default (beta). When false, no OpenCode sidecar/SDK activity
 * runs, the Sessions sidebar is hidden in workspaces, the activity-rail per-
 * workspace session counts are hidden, and the Settings → Workspaces subtree
 * (OpenCode, Config, Providers, MCP servers, Agents, Permissions, Commands,
 * Instructions) is removed from the sidebar. The toggle lives in Settings →
 * Dev. Open session tabs are closed when the feature is switched off so no
 * orphan tabs remain.
 */
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
 * Where system-git version control integration is allowed to run.
 *
 * - `"always"`: git runs wherever enabled (VC view, background badges, etc.).
 * - `"versionControlOnly"`: git runs only while a Version Control view tab is
 *   active in some pane; background callers (project-tree badges, Workspace
 *   Manager column, file-status tracker) skip git entirely. This is the
 *   setting that makes tab/workspace switching produce zero git subprocesses.
 * - `"off"`: behaves exactly like {@link GitIntegrationSettings.enabled}
 *   `false` — no git subprocesses ever, VC UI hidden, drains in-flight work.
 *   Kept as a distinct value (instead of reusing `enabled`) so the master
 *   toggle and the scope can be controlled independently in the UI.
 */
export type GitIntegrationScope = "always" | "versionControlOnly" | "off";

/**
 * Master and behavioral toggles for system-git version control integration.
 *
 * When {@link GitIntegrationSettings.enabled} is false, no git subprocesses
 * run and Version Control UI entry points are hidden.
 */
export interface GitIntegrationSettings {
  /** Master switch — when false, no git subprocesses or VC UI. */
  enabled: boolean;
  /**
   * P03-08-T1 — where git may run. `"off"` is equivalent to `enabled: false`
   * for all gating; `"versionControlOnly"` restricts git to runs initiated by
   * the Version Control view.
   */
  scope: GitIntegrationScope;
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
   * When true (default), typing an opener (bracket, paren, quote, backtick)
   * inserts the matching closer and leaves the cursor inside; typing an
   * existing closer steps over it. Emphasis markers are intentionally not
   * auto-closed (their behavior is not predictable). Reconfigures live.
   */
  autoClosePairs: boolean;
  /**
   * When true, completion suggestions appear automatically while typing.
   * Default off (opt-in). Manual completion (`Ctrl+Space` /
   * `edit.triggerCompletion`) works regardless of this setting. The source
   * reads only the active document — never other files, AI context, or
   * network sources.
   */
  autoSuggest: boolean;
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
  gitIntegration: GitIntegrationSettings;
  opencodeHealth: OpencodeHealthState;
  commandBindingOverrides: CommandBindingOverrides;
  logSettings: LogSettings;
  /** Markdown snippet catalog preferences (M6). */
  markdownSnippets: MarkdownSnippetSettings;
  fontSettings: FontSettings;
  soundSettings: SoundSettings;
  osNotificationSettings: OsNotificationSettings;
  /**
   * Whether the project tree lists hidden files and folders (dotfiles like
   * `.gitignore`, dotdirs like `.zcode`). Default true — these are common
   * working files a developer expects to open. Heavy dirs (`.git`,
   * `node_modules`, etc.) stay hidden regardless. Mirrored to settings.json.
   */
  showHiddenFiles: boolean;
}
