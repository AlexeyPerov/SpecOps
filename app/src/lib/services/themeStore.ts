import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { BuiltinThemeId } from "../styles/themeTokens";
import {
  DEFAULT_BUILTIN_THEME,
  isBuiltinThemeId,
  normalizeLegacyThemeId,
  resolveBuiltinTokens,
  THEME_TOKEN_KEYS,
  type ThemeTokenKey,
  type ThemeTokens,
} from "../styles/themeTokens";
import { ensureSpecOpsDataDir } from "./appDataDir";

export type { ThemeTokens } from "../styles/themeTokens";

export type ActiveThemeRef =
  | { kind: "builtin"; id: BuiltinThemeId }
  | { kind: "custom"; id: string };

export interface CustomThemeRecord {
  id: string;
  name: string;
  baseMode: "dark" | "light";
  tokens: ThemeTokens;
}

export interface ThemeFileV1 {
  version: 1;
  activeTheme: ActiveThemeRef;
  customThemes: CustomThemeRecord[];
}

const FILE_NAME = "theme.json";
const SETTINGS_FILE_NAME = "settings.json";

export const defaultThemeFile: ThemeFileV1 = {
  version: 1,
  activeTheme: { kind: "builtin", id: DEFAULT_BUILTIN_THEME },
  customThemes: [],
};

async function getThemeFilePath(): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  return join(base, FILE_NAME);
}

async function getSettingsFilePath(): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  return join(base, SETTINGS_FILE_NAME);
}

function builtinIdForBaseMode(baseMode: "dark" | "light"): BuiltinThemeId {
  return baseMode === "dark" ? "dark-amber" : "light-blue";
}

function isBaseMode(value: unknown): value is "dark" | "light" {
  return value === "dark" || value === "light";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function migrateFromLegacySettings(theme: string | undefined): ActiveThemeRef | null {
  if (theme === undefined) {
    return null;
  }
  const id = normalizeLegacyThemeId(theme);
  if (id === null) {
    return null;
  }
  return { kind: "builtin", id };
}

export function normalizeThemeTokens(
  baseMode: "dark" | "light",
  tokens: Partial<ThemeTokens> | Record<string, unknown>,
): ThemeTokens {
  const defaults = resolveBuiltinTokens(builtinIdForBaseMode(baseMode));
  const normalized = { ...defaults };

  for (const key of THEME_TOKEN_KEYS) {
    const value = tokens[key];
    if (typeof value === "string" && value.trim().length > 0) {
      normalized[key] = value.trim();
    }
  }

  normalized["color-accent"] = normalized["accent-color"];
  return normalized;
}

function normalizeCustomThemeRecord(raw: unknown): CustomThemeRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (!isNonEmptyString(record.id) || !isNonEmptyString(record.name) || !isBaseMode(record.baseMode)) {
    return null;
  }
  const tokenSource =
    record.tokens && typeof record.tokens === "object"
      ? (record.tokens as Record<string, unknown>)
      : {};

  return {
    id: record.id.trim(),
    name: record.name.trim(),
    baseMode: record.baseMode,
    tokens: normalizeThemeTokens(record.baseMode, tokenSource),
  };
}

function normalizeActiveTheme(
  raw: unknown,
  customThemes: CustomThemeRecord[],
): ActiveThemeRef {
  if (!raw || typeof raw !== "object") {
    return defaultThemeFile.activeTheme;
  }
  const ref = raw as Record<string, unknown>;
  if (ref.kind === "builtin" && typeof ref.id === "string" && isBuiltinThemeId(ref.id)) {
    return { kind: "builtin", id: ref.id };
  }
  if (ref.kind === "custom" && typeof ref.id === "string") {
    const id = ref.id.trim();
    if (customThemes.some((theme) => theme.id === id)) {
      return { kind: "custom", id };
    }
  }
  return defaultThemeFile.activeTheme;
}

function parseThemeFile(raw: string): ThemeFileV1 | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== 1) {
      return null;
    }

    const customThemes: CustomThemeRecord[] = [];
    if (Array.isArray(parsed.customThemes)) {
      const seenIds = new Set<string>();
      for (const entry of parsed.customThemes) {
        const custom = normalizeCustomThemeRecord(entry);
        if (custom && !seenIds.has(custom.id)) {
          seenIds.add(custom.id);
          customThemes.push(custom);
        }
      }
    }

    return {
      version: 1,
      activeTheme: normalizeActiveTheme(parsed.activeTheme, customThemes),
      customThemes,
    };
  } catch {
    return null;
  }
}

function normalizeThemeFile(data: ThemeFileV1): ThemeFileV1 {
  const customThemes = data.customThemes.map((custom) => ({
    ...custom,
    name: custom.name.trim(),
    tokens: normalizeThemeTokens(custom.baseMode, custom.tokens),
  }));

  let activeTheme = data.activeTheme;
  if (activeTheme.kind === "builtin" && !isBuiltinThemeId(activeTheme.id)) {
    activeTheme = defaultThemeFile.activeTheme;
  }
  if (
    activeTheme.kind === "custom" &&
    !customThemes.some((theme) => theme.id === activeTheme.id)
  ) {
    activeTheme = defaultThemeFile.activeTheme;
  }

  return {
    version: 1,
    activeTheme,
    customThemes,
  };
}

async function readLegacySettingsTheme(): Promise<string | undefined> {
  try {
    const path = await getSettingsFilePath();
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.theme === "string") {
      return parsed.theme;
    }
    if (
      (parsed.themeMode === "dark" || parsed.themeMode === "light") &&
      typeof parsed.accent === "string"
    ) {
      return `${parsed.themeMode}-${parsed.accent}`;
    }
  } catch {
    // settings.json missing or unreadable
  }
  return undefined;
}

async function tryMigrateFromSettings(): Promise<ThemeFileV1 | null> {
  const legacyTheme = await readLegacySettingsTheme();
  const activeTheme = migrateFromLegacySettings(legacyTheme);
  if (activeTheme === null) {
    return null;
  }
  const migrated: ThemeFileV1 = {
    version: 1,
    activeTheme,
    customThemes: [],
  };
  await saveThemeFile(migrated);
  return migrated;
}

async function readThemeFileRaw(): Promise<string | null> {
  try {
    const path = await getThemeFilePath();
    return await readTextFile(path);
  } catch {
    return null;
  }
}

export async function loadThemeFile(): Promise<ThemeFileV1> {
  const raw = await readThemeFileRaw();
  if (raw !== null) {
    const parsed = parseThemeFile(raw);
    if (parsed !== null) {
      return normalizeThemeFile(parsed);
    }
    return defaultThemeFile;
  }

  const migrated = await tryMigrateFromSettings();
  if (migrated !== null) {
    return migrated;
  }

  return defaultThemeFile;
}

export async function saveThemeFile(data: ThemeFileV1): Promise<void> {
  const normalized = normalizeThemeFile({
    version: 1,
    activeTheme: data.activeTheme,
    customThemes: data.customThemes,
  });
  const path = await getThemeFilePath();
  await writeTextFile(path, JSON.stringify(normalized, null, 2));
}
