import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  defaultAppProviderSettings,
  normalizeAppProviderSettings,
} from "../ai/providers/appProviderSettings";
import {
  defaultProviderModelCatalogs,
  normalizeProviderModelCatalogs,
} from "../ai/providers/providerModelCatalog";
import type {
  AppProviderSettings,
  ChatHttpSettings,
  ChatModesSettings,
  CommandBindingOverrides,
  ExternalFilesSettings,
  FontSettings,
  GitIntegrationSettings,
  LogSettings,
  MarkdownViewMode,
  OpencodeSettings,
  OsNotificationSettings,
  ProviderModelCatalogs,
  SoundSettings,
} from "../domain/contracts";
import { normalizeChatModesSettings } from "../ai/modes/chatModesSettings";
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
import { defaultChatModesSettings } from "../ai/modes/chatModesSettings";
import {
  defaultOpencodeSettings,
  normalizeOpencodeSettings,
} from "./opencodeSettings";
import {
  defaultChatHttpSettings,
  normalizeChatHttpSettings,
} from "./chatHttpSettings";
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
  chatHttp: ChatHttpSettings;
  gitIntegration: GitIntegrationSettings;
  logSettings: LogSettings;
  chatModes: ChatModesSettings;
  providerSettings: AppProviderSettings;
  providerModelCatalogs: ProviderModelCatalogs;
  commandBindingOverrides: CommandBindingOverrides;
  fontSettings: FontSettings;
  soundSettings: SoundSettings;
  osNotificationSettings: OsNotificationSettings;
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
  chatHttp: defaultChatHttpSettings,
  gitIntegration: defaultGitIntegrationSettings,
  logSettings: defaultLogSettings,
  chatModes: defaultChatModesSettings,
  providerSettings: defaultAppProviderSettings,
  providerModelCatalogs: defaultProviderModelCatalogs,
  commandBindingOverrides: {},
  fontSettings: { ...defaultFontSettings },
  soundSettings: { ...defaultSoundSettings },
  osNotificationSettings: { ...defaultOsNotificationSettings },
};

const FILE_NAME = "settings.json";

async function getSettingsPath(): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  return join(base, FILE_NAME);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
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

    if (isBoolean(parsed.wrapLines) && typeof parsed.zoomPercent === "number") {
      const externalFiles = parseExternalFilesSettings(parsed as Partial<PersistedSettings>);
      const providerModelCatalogs = normalizeProviderModelCatalogs(parsed.providerModelCatalogs);
      const providerSettings = normalizeAppProviderSettings(
        isRecord(parsed.providerSettings) ? parsed.providerSettings : undefined,
        providerModelCatalogs,
      );
      return {
        wrapLines: parsed.wrapLines,
        zoomPercent: parsed.zoomPercent as number,
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
        chatHttp: normalizeChatHttpSettings(parsed.chatHttp),
        gitIntegration: normalizeGitIntegrationSettings(parsed.gitIntegration),
        logSettings: normalizeLogSettings(parsed.logSettings),
        chatModes: normalizeChatModesSettings(parsed.chatModes),
        providerSettings,
        providerModelCatalogs,
        commandBindingOverrides: normalizeCommandBindingOverrides(
          parsed.commandBindingOverrides,
        ),
        fontSettings: normalizeFontSettings(parsed.fontSettings),
        soundSettings: normalizeSoundSettings(parsed.soundSettings),
        osNotificationSettings: normalizeOsNotificationSettings(
          parsed.osNotificationSettings,
        ),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function savePersistedSettings(
  settings: PersistedSettings,
): Promise<void> {
  const path = await getSettingsPath();
  await writeTextFile(path, JSON.stringify(settings, null, 2));
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
  chatHttp: ChatHttpSettings;
  gitIntegration: GitIntegrationSettings;
  logSettings: LogSettings;
  chatModes: ChatModesSettings;
  providerSettings: AppProviderSettings;
  providerModelCatalogs: ProviderModelCatalogs;
  commandBindingOverrides: CommandBindingOverrides;
  fontSettings: FontSettings;
  soundSettings: SoundSettings;
  osNotificationSettings: OsNotificationSettings;
}): PersistedSettings {
  const providerModelCatalogs = normalizeProviderModelCatalogs(input.providerModelCatalogs);
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
    chatHttp: normalizeChatHttpSettings(input.chatHttp),
    gitIntegration: normalizeGitIntegrationSettings(input.gitIntegration),
    logSettings: normalizeLogSettings(input.logSettings),
    chatModes: normalizeChatModesSettings(input.chatModes),
    providerSettings: normalizeAppProviderSettings(input.providerSettings, providerModelCatalogs),
    providerModelCatalogs,
    commandBindingOverrides: normalizeCommandBindingOverrides(input.commandBindingOverrides),
    fontSettings: normalizeFontSettings(input.fontSettings),
    soundSettings: normalizeSoundSettings(input.soundSettings),
    osNotificationSettings: normalizeOsNotificationSettings(input.osNotificationSettings),
  };
}
