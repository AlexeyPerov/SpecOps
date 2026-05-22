import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ensureSpecOpsDataDir } from "./appDataDir";
import type {
  AccentOption,
  ExternalFilesSettings,
  ThemeMode,
} from "../domain/contracts";

export interface PersistedSettings {
  themeMode: ThemeMode;
  accent: AccentOption;
  wrapLines: boolean;
  zoomPercent: number;
  watchExternalChanges: boolean;
  autoReloadCleanFiles: boolean;
  checkOnWindowFocus: boolean;
  checkOnTabActivate: boolean;
}

export const defaultExternalFilesSettings: ExternalFilesSettings = {
  watchExternalChanges: true,
  autoReloadCleanFiles: true,
  checkOnWindowFocus: true,
  checkOnTabActivate: true,
};

export const defaultPersistedSettings: PersistedSettings = {
  themeMode: "dark",
  accent: "blue",
  wrapLines: true,
  zoomPercent: 100,
  ...defaultExternalFilesSettings,
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
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    if (
      (parsed.themeMode === "dark" || parsed.themeMode === "light") &&
      (parsed.accent === "blue" ||
        parsed.accent === "green" ||
        parsed.accent === "violet") &&
      isBoolean(parsed.wrapLines) &&
      typeof parsed.zoomPercent === "number"
    ) {
      const externalFiles = parseExternalFilesSettings(parsed);
      return {
        themeMode: parsed.themeMode,
        accent: parsed.accent,
        wrapLines: parsed.wrapLines,
        zoomPercent: parsed.zoomPercent,
        ...externalFiles,
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
  themeMode: ThemeMode;
  accent: AccentOption;
  wrapLines: boolean;
  zoomPercent: number;
  externalFiles: ExternalFilesSettings;
}): PersistedSettings {
  return {
    themeMode: input.themeMode,
    accent: input.accent,
    wrapLines: input.wrapLines,
    zoomPercent: input.zoomPercent,
    ...input.externalFiles,
  };
}
