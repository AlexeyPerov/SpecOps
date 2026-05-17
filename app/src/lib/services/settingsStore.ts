import { appDataDir, join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { AccentOption, ThemeMode } from "../domain/contracts";

interface PersistedSettings {
  themeMode: ThemeMode;
  accent: AccentOption;
  wrapLines: boolean;
  zoomPercent: number;
}

const FILE_NAME = "settings.json";

async function getSettingsPath(): Promise<string> {
  const base = await appDataDir();
  return join(base, "spec-ops", FILE_NAME);
}

export async function loadPersistedSettings(): Promise<PersistedSettings | null> {
  try {
    const path = await getSettingsPath();
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as PersistedSettings;
    if (
      (parsed.themeMode === "dark" || parsed.themeMode === "light") &&
      (parsed.accent === "blue" ||
        parsed.accent === "green" ||
        parsed.accent === "violet") &&
      typeof parsed.wrapLines === "boolean" &&
      typeof parsed.zoomPercent === "number"
    ) {
      return parsed;
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
