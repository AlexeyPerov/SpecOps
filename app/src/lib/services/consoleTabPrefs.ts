import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ensureSpecOpsDataDir } from "./appDataDir";
import { normalizePathSync } from "./diskFingerprint";

export type ConsoleTabId = "chat" | "logs";

export const DEFAULT_CONSOLE_HEIGHT_PX = 180;
export const MIN_CONSOLE_HEIGHT_PX = 120;

interface ConsoleTabPrefsSnapshot {
  version: 1;
  updatedAt: string;
  tabsByWorkspaceKey: Record<string, ConsoleTabId>;
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

function isConsoleTabId(value: unknown): value is ConsoleTabId {
  return value === "chat" || value === "logs";
}

function hashNormalizedPath(path: string): string {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function workspacePathHashKey(workspaceRoot: string): string {
  return hashNormalizedPath(normalizePathSync(workspaceRoot));
}

async function getPrefsPath(): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  return join(base, FILE_NAME);
}

async function readSnapshot(): Promise<ConsoleTabPrefsSnapshot | null> {
  try {
    const prefsPath = await getPrefsPath();
    const raw = await readTextFile(prefsPath);
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      updatedAt?: unknown;
      tabsByWorkspaceKey?: unknown;
      consoleHeightPx?: unknown;
    };
    if (parsed.version !== 1 || typeof parsed.updatedAt !== "string") {
      return null;
    }
    if (!parsed.tabsByWorkspaceKey || typeof parsed.tabsByWorkspaceKey !== "object") {
      return null;
    }
    const tabsByWorkspaceKey: Record<string, ConsoleTabId> = {};
    for (const [key, value] of Object.entries(parsed.tabsByWorkspaceKey)) {
      if (isConsoleTabId(value)) {
        tabsByWorkspaceKey[key] = value;
      }
    }
    return {
      version: 1,
      updatedAt: parsed.updatedAt,
      tabsByWorkspaceKey,
      consoleHeightPx:
        typeof parsed.consoleHeightPx === "number"
          ? normalizeConsoleHeightPx(parsed.consoleHeightPx)
          : undefined,
    };
  } catch {
    return null;
  }
}

async function writeSnapshot(snapshot: ConsoleTabPrefsSnapshot): Promise<void> {
  const prefsPath = await getPrefsPath();
  await writeTextFile(prefsPath, JSON.stringify(snapshot, null, 2));
}

export async function readWorkspaceConsoleTabPreference(
  workspaceRoot: string,
): Promise<ConsoleTabId | null> {
  const snapshot = await readSnapshot();
  if (!snapshot) {
    return null;
  }
  return snapshot.tabsByWorkspaceKey[workspacePathHashKey(workspaceRoot)] ?? null;
}

async function loadOrCreateSnapshot(): Promise<ConsoleTabPrefsSnapshot> {
  return (
    (await readSnapshot()) ?? {
      version: 1 as const,
      updatedAt: new Date().toISOString(),
      tabsByWorkspaceKey: {},
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

export async function writeWorkspaceConsoleTabPreference(
  workspaceRoot: string,
  tab: ConsoleTabId,
): Promise<void> {
  const key = workspacePathHashKey(workspaceRoot);
  const snapshot = await loadOrCreateSnapshot();
  snapshot.tabsByWorkspaceKey[key] = tab;
  snapshot.updatedAt = new Date().toISOString();
  await writeSnapshot(snapshot);
}
