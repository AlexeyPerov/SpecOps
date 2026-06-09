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
  ChatModesSettings,
  CommandBindingOverrides,
  ExternalFilesSettings,
  LogSettings,
  OpencodeSettings,
  ProviderModelCatalogs,
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
  hideActivityRailWhenNotepadOnly: boolean;
  opencode: OpencodeSettings;
  logSettings: LogSettings;
  chatModes: ChatModesSettings;
  providerSettings: AppProviderSettings;
  providerModelCatalogs: ProviderModelCatalogs;
  commandBindingOverrides: CommandBindingOverrides;
}

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
  hideActivityRailWhenNotepadOnly: true,
  opencode: defaultOpencodeSettings,
  logSettings: defaultLogSettings,
  chatModes: defaultChatModesSettings,
  providerSettings: defaultAppProviderSettings,
  providerModelCatalogs: defaultProviderModelCatalogs,
  commandBindingOverrides: {},
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
        hideActivityRailWhenNotepadOnly: isBoolean(parsed.hideActivityRailWhenNotepadOnly)
          ? parsed.hideActivityRailWhenNotepadOnly
          : defaultPersistedSettings.hideActivityRailWhenNotepadOnly,
        opencode: normalizeOpencodeSettings(parsed.opencode),
        logSettings: normalizeLogSettings(parsed.logSettings),
        chatModes: normalizeChatModesSettings(parsed.chatModes),
        providerSettings,
        providerModelCatalogs,
        commandBindingOverrides: normalizeCommandBindingOverrides(
          parsed.commandBindingOverrides,
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
  hideActivityRailWhenNotepadOnly: boolean;
  opencode: OpencodeSettings;
  logSettings: LogSettings;
  chatModes: ChatModesSettings;
  providerSettings: AppProviderSettings;
  providerModelCatalogs: ProviderModelCatalogs;
  commandBindingOverrides: CommandBindingOverrides;
}): PersistedSettings {
  const providerModelCatalogs = normalizeProviderModelCatalogs(input.providerModelCatalogs);
  return {
    wrapLines: input.wrapLines,
    zoomPercent: input.zoomPercent,
    ...input.externalFiles,
    decoratePlaintextSymbols: input.decoratePlaintextSymbols,
    hideActivityRailWhenNotepadOnly: input.hideActivityRailWhenNotepadOnly,
    opencode: normalizeOpencodeSettings(input.opencode),
    logSettings: normalizeLogSettings(input.logSettings),
    chatModes: normalizeChatModesSettings(input.chatModes),
    providerSettings: normalizeAppProviderSettings(input.providerSettings, providerModelCatalogs),
    providerModelCatalogs,
    commandBindingOverrides: normalizeCommandBindingOverrides(input.commandBindingOverrides),
  };
}
