import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  defaultDebugProviderSettings,
  normalizeDebugProviderSettings,
} from "../ai/providers/debugProviderSettings";
import {
  defaultGlmProviderSettings,
  normalizeGlmProviderSettings,
} from "../ai/providers/glmProviderSettings";
import type { DebugProviderSettings, ExternalFilesSettings, GlmProviderSettings } from "../domain/contracts";
import { ensureSpecOpsDataDir } from "./appDataDir";

export interface PersistedSettings {
  wrapLines: boolean;
  zoomPercent: number;
  watchExternalChanges: boolean;
  autoReloadCleanFiles: boolean;
  checkOnWindowFocus: boolean;
  checkOnTabActivate: boolean;
  decoratePlaintextSymbols: boolean;
  hideActivityRailWhenNotepadOnly: boolean;
  debugProvider: DebugProviderSettings;
  glmProvider: GlmProviderSettings;
}

export const defaultExternalFilesSettings: ExternalFilesSettings = {
  watchExternalChanges: true,
  autoReloadCleanFiles: true,
  checkOnWindowFocus: true,
  checkOnTabActivate: true,
};

export const defaultPersistedSettings: PersistedSettings = {
  wrapLines: true,
  zoomPercent: 100,
  ...defaultExternalFilesSettings,
  decoratePlaintextSymbols: true,
  hideActivityRailWhenNotepadOnly: true,
  debugProvider: defaultDebugProviderSettings,
  glmProvider: defaultGlmProviderSettings,
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

    if (isBoolean(parsed.wrapLines) && typeof parsed.zoomPercent === "number") {
      const externalFiles = parseExternalFilesSettings(parsed as Partial<PersistedSettings>);
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
        debugProvider: normalizeDebugProviderSettings(parsed.debugProvider),
        glmProvider: normalizeGlmProviderSettings(parsed.glmProvider),
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
  wrapLines: boolean;
  zoomPercent: number;
  externalFiles: ExternalFilesSettings;
  decoratePlaintextSymbols: boolean;
  hideActivityRailWhenNotepadOnly: boolean;
  debugProvider: DebugProviderSettings;
  glmProvider: GlmProviderSettings;
}): PersistedSettings {
  return {
    wrapLines: input.wrapLines,
    zoomPercent: input.zoomPercent,
    ...input.externalFiles,
    decoratePlaintextSymbols: input.decoratePlaintextSymbols,
    hideActivityRailWhenNotepadOnly: input.hideActivityRailWhenNotepadOnly,
    debugProvider: normalizeDebugProviderSettings(input.debugProvider),
    glmProvider: normalizeGlmProviderSettings(input.glmProvider),
  };
}
