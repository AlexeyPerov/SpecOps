import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ensureSpecOpsDataDir } from "./appDataDir";

export const DEFAULT_CONSOLE_HEIGHT_PX = 180;
export const MIN_CONSOLE_HEIGHT_PX = 120;

interface ConsolePrefsSnapshot {
  version: 1;
  updatedAt: string;
  consoleHeightPx?: number;
}

const FILE_NAME = "console-tab-prefs.json";

/** Clamps console panel height for resize and persisted prefs. */
export function normalizeConsoleHeightPx(
  value: unknown,
  viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800,
): number {
  const maxHeight = Math.max(
    MIN_CONSOLE_HEIGHT_PX,
    Math.floor(viewportHeight * 0.5),
  );
  const fallback = DEFAULT_CONSOLE_HEIGHT_PX;
  const parsed =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(MIN_CONSOLE_HEIGHT_PX, Math.min(maxHeight, parsed));
}

async function getPrefsPath(): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  return join(base, FILE_NAME);
}

async function readSnapshot(): Promise<ConsolePrefsSnapshot | null> {
  try {
    const prefsPath = await getPrefsPath();
    const raw = await readTextFile(prefsPath);
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      updatedAt?: unknown;
      consoleHeightPx?: unknown;
    };
    if (parsed.version !== 1 || typeof parsed.updatedAt !== "string") {
      return null;
    }
    return {
      version: 1,
      updatedAt: parsed.updatedAt,
      consoleHeightPx:
        typeof parsed.consoleHeightPx === "number"
          ? normalizeConsoleHeightPx(parsed.consoleHeightPx)
          : undefined,
    };
  } catch {
    return null;
  }
}

async function writeSnapshot(snapshot: ConsolePrefsSnapshot): Promise<void> {
  const prefsPath = await getPrefsPath();
  await writeTextFile(prefsPath, JSON.stringify(snapshot, null, 2));
}

async function loadOrCreateSnapshot(): Promise<ConsolePrefsSnapshot> {
  return (
    (await readSnapshot()) ?? {
      version: 1 as const,
      updatedAt: new Date().toISOString(),
    }
  );
}

export async function readConsoleHeightPreference(): Promise<number> {
  const snapshot = await readSnapshot();
  if (!snapshot?.consoleHeightPx) {
    return DEFAULT_CONSOLE_HEIGHT_PX;
  }
  return normalizeConsoleHeightPx(snapshot.consoleHeightPx);
}

export async function writeConsoleHeightPreference(heightPx: number): Promise<void> {
  const snapshot = await loadOrCreateSnapshot();
  snapshot.consoleHeightPx = normalizeConsoleHeightPx(heightPx);
  snapshot.updatedAt = new Date().toISOString();
  await writeSnapshot(snapshot);
}
