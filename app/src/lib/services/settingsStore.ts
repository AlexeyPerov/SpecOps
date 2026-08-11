import { join } from "@tauri-apps/api/path";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { atomicWriteTextFile } from "./atomicWrite";
import type {
  MarkdownSnippetSettings,
  CommandBindingOverrides,
  ExternalFilesSettings,
  FontSettings,
  GitIntegrationSettings,
  LogSettings,
  MarkdownViewMode,
  OpencodeSettings,
  OsNotificationSettings,
  SoundSettings,
} from "../domain/contracts";
import { normalizeMarkdownSnippetSettings } from "../editor/markdownSnippetSettings";
import { normalizeCommandBindingOverrides } from "../commands/commandBindings";
import { ensureSpecOpsDataDir } from "./appDataDir";
import {
  DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES,
  normalizeMaxBinaryOpenAsTextBytes,
} from "./binaryFileOpen";
import {
  DEFAULT_MAX_OPEN_WITHOUT_CONFIRM_BYTES,
  normalizeMaxOpenWithoutConfirmBytes,
} from "./largeFileOpen";
import { defaultLogSettings, normalizeLogSettings } from "./logSettings";
import { defaultMarkdownSnippetSettings } from "../editor/markdownSnippetSettings";
import {
  defaultOpencodeSettings,
  normalizeOpencodeSettings,
} from "./opencodeSettings";
import {
  defaultGitIntegrationSettings,
  normalizeGitIntegrationSettings,
} from "./gitIntegrationSettings";
import {
  defaultFontSettings,
  normalizeFontSettings,
} from "./fontSettings";
import {
  defaultOsNotificationSettings,
  defaultSoundSettings,
  normalizeOsNotificationSettings,
  normalizeSoundSettings,
} from "./notificationSettings";

export interface PersistedSettings {
  wrapLines: boolean;
  zoomPercent: number;
  watchExternalChanges: boolean;
  autoReloadCleanFiles: boolean;
  checkOnWindowFocus: boolean;
  checkOnTabActivate: boolean;
  maxBinaryOpenAsTextBytes: number;
  maxOpenWithoutConfirmBytes: number;
  decoratePlaintextSymbols: boolean;
  showMinimap: boolean;
  showFoldGutter: boolean;
  autoClosePairs: boolean;
  autoSuggest: boolean;
  defaultMarkdownViewMode: MarkdownViewMode;
  restrictFilesToContext: boolean;
  opencode: OpencodeSettings;
  gitIntegration: GitIntegrationSettings;
  logSettings: LogSettings;
  markdownSnippets: MarkdownSnippetSettings;
  commandBindingOverrides: CommandBindingOverrides;
  fontSettings: FontSettings;
  soundSettings: SoundSettings;
  osNotificationSettings: OsNotificationSettings;
  showHiddenFiles: boolean;
}

const MARKDOWN_VIEW_MODES: readonly MarkdownViewMode[] = ["edit", "split", "preview"];

export const defaultExternalFilesSettings: ExternalFilesSettings = {
  watchExternalChanges: true,
  autoReloadCleanFiles: true,
  checkOnWindowFocus: true,
  checkOnTabActivate: true,
  maxBinaryOpenAsTextBytes: DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES,
  maxOpenWithoutConfirmBytes: DEFAULT_MAX_OPEN_WITHOUT_CONFIRM_BYTES,
};

export const defaultPersistedSettings: PersistedSettings = {
  wrapLines: true,
  zoomPercent: 100,
  ...defaultExternalFilesSettings,
  decoratePlaintextSymbols: true,
  showMinimap: true,
  showFoldGutter: true,
  autoClosePairs: true,
  autoSuggest: false,
  defaultMarkdownViewMode: "preview",
  restrictFilesToContext: false,
  opencode: defaultOpencodeSettings,
  gitIntegration: defaultGitIntegrationSettings,
  logSettings: defaultLogSettings,
  markdownSnippets: defaultMarkdownSnippetSettings,
  commandBindingOverrides: {},
  fontSettings: { ...defaultFontSettings },
  soundSettings: { ...defaultSoundSettings },
  osNotificationSettings: { ...defaultOsNotificationSettings },
  showHiddenFiles: true,
};

const FILE_NAME = "settings.json";

async function getSettingsPath(): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  return join(base, FILE_NAME);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Matches the range enforced by the view.zoomIn / view.zoomOut commands. */
const MIN_ZOOM_PERCENT = 60;
const MAX_ZOOM_PERCENT = 220;

/**
 * Clamp a persisted zoom value into the range the zoom commands enforce.
 * `typeof NaN === "number"`, so a bare typeof check would let NaN (or a
 * hand-edited 10000) through and break every font-size computation.
 */
export function normalizeZoomPercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultPersistedSettings.zoomPercent;
  }
  return Math.min(MAX_ZOOM_PERCENT, Math.max(MIN_ZOOM_PERCENT, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseExternalFilesSettings(parsed: Partial<PersistedSettings>): ExternalFilesSettings {
  return {
    watchExternalChanges: isBoolean(parsed.watchExternalChanges)
      ? parsed.watchExternalChanges
      : defaultExternalFilesSettings.watchExternalChanges,
    autoReloadCleanFiles: isBoolean(parsed.autoReloadCleanFiles)
      ? parsed.autoReloadCleanFiles
      : defaultExternalFilesSettings.autoReloadCleanFiles,
    checkOnWindowFocus: isBoolean(parsed.checkOnWindowFocus)
      ? parsed.checkOnWindowFocus
      : defaultExternalFilesSettings.checkOnWindowFocus,
    checkOnTabActivate: isBoolean(parsed.checkOnTabActivate)
      ? parsed.checkOnTabActivate
      : defaultExternalFilesSettings.checkOnTabActivate,
    maxBinaryOpenAsTextBytes: normalizeMaxBinaryOpenAsTextBytes(parsed.maxBinaryOpenAsTextBytes),
    maxOpenWithoutConfirmBytes: normalizeMaxOpenWithoutConfirmBytes(
      parsed.maxOpenWithoutConfirmBytes,
    ),
  };
}

export async function loadPersistedSettings(): Promise<PersistedSettings | null> {
  try {
    const path = await getSettingsPath();
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Every field falls back to its default individually. A missing or
    // renamed field (old schema, hand-edit) must not discard the entire
    // file — returning null here would boot on defaults and then overwrite
    // settings.json, losing every other setting the user had.
    if (isRecord(parsed)) {
      const externalFiles = parseExternalFilesSettings(parsed as Partial<PersistedSettings>);
      return {
        wrapLines: isBoolean(parsed.wrapLines)
          ? parsed.wrapLines
          : defaultPersistedSettings.wrapLines,
        zoomPercent: normalizeZoomPercent(parsed.zoomPercent),
        ...externalFiles,
        decoratePlaintextSymbols: isBoolean(parsed.decoratePlaintextSymbols)
          ? parsed.decoratePlaintextSymbols
          : defaultPersistedSettings.decoratePlaintextSymbols,
        showMinimap: isBoolean(parsed.showMinimap)
          ? parsed.showMinimap
          : defaultPersistedSettings.showMinimap,
        showFoldGutter: isBoolean(parsed.showFoldGutter)
          ? parsed.showFoldGutter
          : defaultPersistedSettings.showFoldGutter,
        autoClosePairs: isBoolean(parsed.autoClosePairs)
          ? parsed.autoClosePairs
          : defaultPersistedSettings.autoClosePairs,
        autoSuggest: isBoolean(parsed.autoSuggest)
          ? parsed.autoSuggest
          : defaultPersistedSettings.autoSuggest,
        defaultMarkdownViewMode: MARKDOWN_VIEW_MODES.includes(
          parsed.defaultMarkdownViewMode as MarkdownViewMode,
        )
          ? (parsed.defaultMarkdownViewMode as MarkdownViewMode)
          : defaultPersistedSettings.defaultMarkdownViewMode,
        restrictFilesToContext: isBoolean(parsed.restrictFilesToContext)
          ? parsed.restrictFilesToContext
          : defaultPersistedSettings.restrictFilesToContext,
        opencode: normalizeOpencodeSettings(parsed.opencode),
        gitIntegration: normalizeGitIntegrationSettings(parsed.gitIntegration),
        logSettings: normalizeLogSettings(parsed.logSettings),
        markdownSnippets: normalizeMarkdownSnippetSettings(parsed.markdownSnippets),
        commandBindingOverrides: normalizeCommandBindingOverrides(
          parsed.commandBindingOverrides,
        ),
        fontSettings: normalizeFontSettings(parsed.fontSettings),
        soundSettings: normalizeSoundSettings(parsed.soundSettings),
        osNotificationSettings: normalizeOsNotificationSettings(
          parsed.osNotificationSettings,
        ),
        showHiddenFiles: isBoolean(parsed.showHiddenFiles)
          ? parsed.showHiddenFiles
          : defaultPersistedSettings.showHiddenFiles,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Saves are chained so writes to settings.json never overlap (concurrent
 * non-atomic writes to one path are how the file gets torn), and each write
 * goes to a temp file that is renamed over the target, so a crash or full disk
 * mid-write leaves the previous settings.json intact instead of a truncated one.
 */
let settingsSaveChain: Promise<void> = Promise.resolve();

async function writeSettingsFileAtomically(settings: PersistedSettings): Promise<void> {
  const path = await getSettingsPath();
  await atomicWriteTextFile(path, JSON.stringify(settings, null, 2));
}

export async function savePersistedSettings(
  settings: PersistedSettings,
): Promise<void> {
  const run = settingsSaveChain.then(() => writeSettingsFileAtomically(settings));
  // Keep the chain usable after a failed write; the failure still propagates
  // to this call's returned promise.
  settingsSaveChain = run.catch(() => {});
  return run;
}

export function toExternalFilesSettings(
  settings: PersistedSettings,
): ExternalFilesSettings {
  return {
    watchExternalChanges: settings.watchExternalChanges,
    autoReloadCleanFiles: settings.autoReloadCleanFiles,
    checkOnWindowFocus: settings.checkOnWindowFocus,
    checkOnTabActivate: settings.checkOnTabActivate,
    maxBinaryOpenAsTextBytes: settings.maxBinaryOpenAsTextBytes,
    maxOpenWithoutConfirmBytes: settings.maxOpenWithoutConfirmBytes,
  };
}

export function toPersistedSettings(input: {
  wrapLines: boolean;
  zoomPercent: number;
  externalFiles: ExternalFilesSettings;
  decoratePlaintextSymbols: boolean;
  showMinimap: boolean;
  showFoldGutter: boolean;
  autoClosePairs: boolean;
  autoSuggest: boolean;
  defaultMarkdownViewMode: MarkdownViewMode;
  restrictFilesToContext: boolean;
  opencode: OpencodeSettings;
  gitIntegration: GitIntegrationSettings;
  logSettings: LogSettings;
  markdownSnippets: MarkdownSnippetSettings;
  commandBindingOverrides: CommandBindingOverrides;
  fontSettings: FontSettings;
  soundSettings: SoundSettings;
  osNotificationSettings: OsNotificationSettings;
  showHiddenFiles: boolean;
}): PersistedSettings {
  return {
    wrapLines: input.wrapLines,
    zoomPercent: input.zoomPercent,
    ...input.externalFiles,
    decoratePlaintextSymbols: input.decoratePlaintextSymbols,
    showMinimap: isBoolean(input.showMinimap)
      ? input.showMinimap
      : defaultPersistedSettings.showMinimap,
    showFoldGutter: isBoolean(input.showFoldGutter)
      ? input.showFoldGutter
      : defaultPersistedSettings.showFoldGutter,
    autoClosePairs: isBoolean(input.autoClosePairs)
      ? input.autoClosePairs
      : defaultPersistedSettings.autoClosePairs,
    autoSuggest: isBoolean(input.autoSuggest)
      ? input.autoSuggest
      : defaultPersistedSettings.autoSuggest,
    defaultMarkdownViewMode: MARKDOWN_VIEW_MODES.includes(
      input.defaultMarkdownViewMode as MarkdownViewMode,
    )
      ? (input.defaultMarkdownViewMode as MarkdownViewMode)
      : defaultPersistedSettings.defaultMarkdownViewMode,
    restrictFilesToContext: isBoolean(input.restrictFilesToContext)
      ? input.restrictFilesToContext
      : defaultPersistedSettings.restrictFilesToContext,
    opencode: normalizeOpencodeSettings(input.opencode),
    gitIntegration: normalizeGitIntegrationSettings(input.gitIntegration),
    logSettings: normalizeLogSettings(input.logSettings),
    markdownSnippets: normalizeMarkdownSnippetSettings(input.markdownSnippets),
    commandBindingOverrides: normalizeCommandBindingOverrides(input.commandBindingOverrides),
    fontSettings: normalizeFontSettings(input.fontSettings),
    soundSettings: normalizeSoundSettings(input.soundSettings),
    osNotificationSettings: normalizeOsNotificationSettings(input.osNotificationSettings),
    showHiddenFiles: isBoolean(input.showHiddenFiles)
      ? input.showHiddenFiles
      : defaultPersistedSettings.showHiddenFiles,
  };
}
