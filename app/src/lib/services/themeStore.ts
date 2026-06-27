import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { IMPORTED_THEMES } from "../styles/importedThemes";
import type { BuiltinThemeId } from "../styles/themeTokens";
import {
  DEFAULT_BUILTIN_THEME,
  isBuiltinThemeId,
  normalizeLegacyThemeId,
  resolveBuiltinTokens,
  THEME_TOKEN_KEYS,
  getBuiltinThemeMode,
  type ThemeTokenKey,
  type ThemeTokens,
} from "../styles/themeTokens";
import type { ThemeMode } from "../domain/settings";
import { ensureSpecOpsDataDir } from "./appDataDir";

export type { ThemeTokens } from "../styles/themeTokens";

export type ActiveThemeRef =
  | { kind: "builtin"; id: BuiltinThemeId }
  | { kind: "preset"; id: string }
  | { kind: "custom"; id: string };

export interface CustomThemeRecord {
  id: string;
  name: string;
  baseMode: "dark" | "light";
  tokens: ThemeTokens;
}

/**
 * Canonical on-disk theme file. `darkTheme`/`lightTheme` are the two themes
 * `auto` mode switches between; `manualTheme` is the single theme pinned when
 * `mode === "manual"`; `mode` decides which is effective (`auto` follows the
 * OS `prefers-color-scheme` media query).
 */
export interface ThemeFileV2 {
  version: 2;
  mode: ThemeMode;
  darkTheme: ActiveThemeRef;
  lightTheme: ActiveThemeRef;
  manualTheme: ActiveThemeRef;
  customThemes: CustomThemeRecord[];
}

const FILE_NAME = "theme.json";
const SETTINGS_FILE_NAME = "settings.json";

const DEFAULT_DARK_BUILTIN: ActiveThemeRef = { kind: "builtin", id: "dark-amber" };
const DEFAULT_LIGHT_BUILTIN: ActiveThemeRef = { kind: "builtin", id: "light-blue" };
const DEFAULT_MANUAL_BUILTIN: ActiveThemeRef = { kind: "builtin", id: "dark-amber" };
// Fresh-install defaults pick the curated `turnip` preset for the dark and
// manual slots (turnip is a dark theme), so a brand-new user lands on it.
const DEFAULT_DARK: ActiveThemeRef = { kind: "preset", id: "turnip" };
const DEFAULT_MANUAL: ActiveThemeRef = { kind: "preset", id: "turnip" };

export const defaultThemeFile: ThemeFileV2 = {
  version: 2,
  mode: "auto",
  darkTheme: DEFAULT_DARK,
  lightTheme: DEFAULT_LIGHT_BUILTIN,
  manualTheme: DEFAULT_MANUAL,
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
  fallback: ActiveThemeRef,
): ActiveThemeRef {
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const ref = raw as Record<string, unknown>;
  if (ref.kind === "builtin" && typeof ref.id === "string" && isBuiltinThemeId(ref.id)) {
    return { kind: "builtin", id: ref.id };
  }
  if (ref.kind === "preset" && typeof ref.id === "string") {
    const id = ref.id.trim();
    // A preset id may vanish in a future version (curated set changed); fall
    // back to the provided default rather than resolving to a missing theme.
    if (IMPORTED_THEMES.some((preset) => preset.id === id)) {
      return { kind: "preset", id };
    }
    return fallback;
  }
  if (ref.kind === "custom" && typeof ref.id === "string") {
    const id = ref.id.trim();
    if (customThemes.some((theme) => theme.id === id)) {
      return { kind: "custom", id };
    }
  }
  return fallback;
}

/**
 * Resolves the dark/light classification of a theme ref, used only to seed the
 * dark/light slot from a legacy `activeTheme` during defensive normalization
 * (per AGENTS.md: no data migrations — old files simply re-seed defaults).
 */
function baseModeForRef(
  ref: ActiveThemeRef,
  customThemes: CustomThemeRecord[],
): "dark" | "light" {
  if (ref.kind === "builtin") {
    return getBuiltinThemeMode(ref.id);
  }
  if (ref.kind === "preset") {
    return IMPORTED_THEMES.find((p) => p.id === ref.id)?.baseMode ?? "dark";
  }
  return customThemes.find((theme) => theme.id === ref.id)?.baseMode ?? "dark";
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "auto" || value === "manual";
}

/**
 * Parses a `theme.json` blob into a V2 file. Accepts both `version: 2`
 * (canonical) and `version: 1` (legacy) payloads; V1 is defensively seeded to
 * V2 by slotting the old `activeTheme` into the matching dark/light slot and
 * defaulting `mode` to `auto`. Any other version returns `null` so the caller
 * falls back to defaults.
 */
function parseThemeFile(raw: string): ThemeFileV2 | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

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

    if (parsed.version === 1) {
      // Legacy V1 → V2 defensive seeding (NOT a migration: the file is rewritten
      // as V2 on the next save). The old single activeTheme becomes whichever
      // dark/light slot it belongs to; the other slot stays at its builtin default.
      const legacyActive = normalizeActiveTheme(parsed.activeTheme, customThemes, DEFAULT_DARK_BUILTIN);
      const seededDark =
        baseModeForRef(legacyActive, customThemes) === "dark" ? legacyActive : DEFAULT_DARK_BUILTIN;
      const seededLight =
        baseModeForRef(legacyActive, customThemes) === "light"
          ? legacyActive
          : DEFAULT_LIGHT_BUILTIN;
      return {
        version: 2,
        mode: "auto",
        darkTheme: seededDark,
        lightTheme: seededLight,
        manualTheme: DEFAULT_MANUAL_BUILTIN,
        customThemes,
      };
    }

    if (parsed.version !== 2) {
      return null;
    }

    return {
      version: 2,
      mode: isThemeMode(parsed.mode) ? parsed.mode : "auto",
      darkTheme: normalizeActiveTheme(parsed.darkTheme, customThemes, DEFAULT_DARK_BUILTIN),
      lightTheme: normalizeActiveTheme(parsed.lightTheme, customThemes, DEFAULT_LIGHT_BUILTIN),
      // Files written before manualTheme existed default to dark-amber (no migration).
      manualTheme: normalizeActiveTheme(parsed.manualTheme, customThemes, DEFAULT_MANUAL_BUILTIN),
      customThemes,
    };
  } catch {
    return null;
  }
}

function normalizeThemeFile(data: ThemeFileV2): ThemeFileV2 {
  const customThemes = data.customThemes.map((custom) => ({
    ...custom,
    name: custom.name.trim(),
    tokens: normalizeThemeTokens(custom.baseMode, custom.tokens),
  }));

  const validRef = (ref: ActiveThemeRef): boolean => {
    if (ref.kind === "builtin") return isBuiltinThemeId(ref.id);
    if (ref.kind === "preset") return IMPORTED_THEMES.some((p) => p.id === ref.id);
    return customThemes.some((theme) => theme.id === ref.id);
  };

  const darkTheme = validRef(data.darkTheme) ? data.darkTheme : DEFAULT_DARK_BUILTIN;
  const lightTheme = validRef(data.lightTheme) ? data.lightTheme : DEFAULT_LIGHT_BUILTIN;
  const manualTheme = validRef(data.manualTheme) ? data.manualTheme : DEFAULT_MANUAL_BUILTIN;
  const mode: ThemeMode = isThemeMode(data.mode) ? data.mode : "auto";

  return {
    version: 2,
    mode,
    darkTheme,
    lightTheme,
    manualTheme,
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

/**
 * Defensive seeding from a legacy `settings.json` (pre-theme.json era). Not a
 * migration: maps the old `theme`/`themeMode`+`accent` to a builtin, slots it
 * into dark or light, and writes a fresh V2 file.
 */
async function tryMigrateFromSettings(): Promise<ThemeFileV2 | null> {
  const legacyTheme = await readLegacySettingsTheme();
  const activeTheme = migrateFromLegacySettings(legacyTheme);
  if (activeTheme === null) {
    return null;
  }
  const seededDark = baseModeForRef(activeTheme, []) === "dark" ? activeTheme : DEFAULT_DARK_BUILTIN;
  const seededLight =
    baseModeForRef(activeTheme, []) === "light" ? activeTheme : DEFAULT_LIGHT_BUILTIN;
  const migrated: ThemeFileV2 = {
    version: 2,
    mode: "auto",
    darkTheme: seededDark,
    lightTheme: seededLight,
    manualTheme: DEFAULT_MANUAL_BUILTIN,
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

export async function loadThemeFile(): Promise<ThemeFileV2> {
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

export async function saveThemeFile(data: ThemeFileV2): Promise<void> {
  const normalized = normalizeThemeFile({
    version: 2,
    mode: data.mode,
    darkTheme: data.darkTheme,
    lightTheme: data.lightTheme,
    manualTheme: data.manualTheme,
    customThemes: data.customThemes,
  });
  const path = await getThemeFilePath();
  await writeTextFile(path, JSON.stringify(normalized, null, 2));
}
