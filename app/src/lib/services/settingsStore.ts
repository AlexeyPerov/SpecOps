import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  defaultDebugProviderSettings,
  normalizeDebugProviderSettings,
} from "../ai/providers/debugProviderSettings";
import type { DebugProviderSettings, ExternalFilesSettings } from "../domain/contracts";
import type { AppTheme } from "../styles/themes";
import { isValidTheme } from "../styles/themes";
import { ensureSpecOpsDataDir } from "./appDataDir";

export interface PersistedSettings {
  theme: AppTheme;
  wrapLines: boolean;
  zoomPercent: number;
  watchExternalChanges: boolean;
  autoReloadCleanFiles: boolean;
  checkOnWindowFocus: boolean;
  checkOnTabActivate: boolean;
  decoratePlaintextSymbols: boolean;
  hideActivityRailWhenNotepadOnly: boolean;
  debugProvider: DebugProviderSettings;
}

export const defaultExternalFilesSettings: ExternalFilesSettings = {
  watchExternalChanges: true,
  autoReloadCleanFiles: true,
  checkOnWindowFocus: true,
  checkOnTabActivate: true,
};

export const defaultPersistedSettings: PersistedSettings = {
  theme: "dark-blue",
  wrapLines: true,
  zoomPercent: 100,
  ...defaultExternalFilesSettings,
  decoratePlaintextSymbols: true,
  hideActivityRailWhenNotepadOnly: true,
  debugProvider: defaultDebugProviderSettings,
};

const FILE_NAME = "settings.json";

async function getSettingsPath(): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  return join(base, FILE_NAME);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
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
  };
}

export async function loadPersistedSettings(): Promise<PersistedSettings | null> {
  try {
    const path = await getSettingsPath();
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    let theme: AppTheme | null = null;

    if (typeof parsed.theme === "string" && isValidTheme(parsed.theme)) {
      theme = parsed.theme;
    } else if (
      (parsed.themeMode === "dark" || parsed.themeMode === "light") &&
      typeof parsed.accent === "string"
    ) {
      const candidate = `${parsed.themeMode}-${parsed.accent}` as AppTheme;
      if (isValidTheme(candidate)) {
        theme = candidate;
      }
    }

    if (
      theme !== null &&
      isBoolean(parsed.wrapLines) &&
      typeof parsed.zoomPercent === "number"
    ) {
      const externalFiles = parseExternalFilesSettings(parsed as Partial<PersistedSettings>);
      return {
        theme,
        wrapLines: parsed.wrapLines,
        zoomPercent: parsed.zoomPercent as number,
        ...externalFiles,
        decoratePlaintextSymbols: isBoolean(parsed.decoratePlaintextSymbols)
          ? parsed.decoratePlaintextSymbols
          : defaultPersistedSettings.decoratePlaintextSymbols,
        hideActivityRailWhenNotepadOnly: isBoolean(parsed.hideActivityRailWhenNotepadOnly)
          ? parsed.hideActivityRailWhenNotepadOnly
          : defaultPersistedSettings.hideActivityRailWhenNotepadOnly,
        debugProvider: normalizeDebugProviderSettings(parsed.debugProvider),
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
  };
}

export function toPersistedSettings(input: {
  theme: AppTheme;
  wrapLines: boolean;
  zoomPercent: number;
  externalFiles: ExternalFilesSettings;
  decoratePlaintextSymbols: boolean;
  hideActivityRailWhenNotepadOnly: boolean;
  debugProvider: DebugProviderSettings;
}): PersistedSettings {
  return {
    theme: input.theme,
    wrapLines: input.wrapLines,
    zoomPercent: input.zoomPercent,
    ...input.externalFiles,
    decoratePlaintextSymbols: input.decoratePlaintextSymbols,
    hideActivityRailWhenNotepadOnly: input.hideActivityRailWhenNotepadOnly,
    debugProvider: normalizeDebugProviderSettings(input.debugProvider),
  };
}
