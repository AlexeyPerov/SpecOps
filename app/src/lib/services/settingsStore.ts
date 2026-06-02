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
  ExternalFilesSettings,
  ProviderModelCatalogs,
} from "../domain/contracts";
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
  providerSettings: AppProviderSettings;
  providerModelCatalogs: ProviderModelCatalogs;
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
  providerSettings: defaultAppProviderSettings,
  providerModelCatalogs: defaultProviderModelCatalogs,
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
  };
}

function legacyGlmModelIdFromParsed(parsed: Record<string, unknown>): string | undefined {
  const bundled = parsed.providerSettings;
  if (isRecord(bundled) && isRecord(bundled.glm) && typeof bundled.glm.modelId === "string") {
    return bundled.glm.modelId;
  }
  return undefined;
}

export async function loadPersistedSettings(): Promise<PersistedSettings | null> {
  try {
    const path = await getSettingsPath();
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (isBoolean(parsed.wrapLines) && typeof parsed.zoomPercent === "number") {
      const externalFiles = parseExternalFilesSettings(parsed as Partial<PersistedSettings>);
      const hasExplicitGlmCatalog =
        isRecord(parsed.providerModelCatalogs) && isRecord(parsed.providerModelCatalogs.glm);
      const providerModelCatalogs = normalizeProviderModelCatalogs(
        parsed.providerModelCatalogs,
        hasExplicitGlmCatalog
          ? {}
          : {
              glmModelId: legacyGlmModelIdFromParsed(parsed),
            },
      );
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
        providerSettings,
        providerModelCatalogs,
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
  providerSettings: AppProviderSettings;
  providerModelCatalogs: ProviderModelCatalogs;
}): PersistedSettings {
  const providerModelCatalogs = normalizeProviderModelCatalogs(input.providerModelCatalogs, {
    glmModelId: input.providerSettings.glm.modelId,
  });
  return {
    wrapLines: input.wrapLines,
    zoomPercent: input.zoomPercent,
    ...input.externalFiles,
    decoratePlaintextSymbols: input.decoratePlaintextSymbols,
    hideActivityRailWhenNotepadOnly: input.hideActivityRailWhenNotepadOnly,
    providerSettings: normalizeAppProviderSettings(input.providerSettings, providerModelCatalogs),
    providerModelCatalogs,
  };
}
