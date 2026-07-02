import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { ensureSpecOpsDataDir } from "./appDataDir";
import { normalizePathSync } from "./diskFingerprint";

/**
 * Global workspace preferences, shared across windows and keyed by normalized
 * root path (decision 9). Currently holds only the `hiddenFromRail` flag
 * (decision 3): a soft-hide that omits a workspace from the activity rail while
 * keeping it in the session and the Workspace Manager.
 *
 * Persisted as `workspace-preferences.json` in the app data dir. Membership
 * (which workspaces are open) is session-scoped and lives in appState; this file
 * is purely the cross-window per-path preference overlay.
 */

interface WorkspacePreferenceEntry {
  hiddenFromRail: boolean;
}

interface WorkspacePreferencesFile {
  /** Keyed by normalized root path. */
  workspaces: Record<string, WorkspacePreferenceEntry>;
}

const PREFERENCES_FILENAME = "workspace-preferences.json";

let cache: Map<string, WorkspacePreferenceEntry> | null = null;
const listeners = new Set<(hiddenPaths: Set<string>) => void>();

async function preferencesFilePath(): Promise<string> {
  const dir = await ensureSpecOpsDataDir();
  return join(dir, PREFERENCES_FILENAME);
}

function normalizeFile(raw: unknown): WorkspacePreferencesFile {
  if (!raw || typeof raw !== "object") {
    return { workspaces: {} };
  }
  const candidate = raw as Partial<WorkspacePreferencesFile>;
  const workspaces = candidate.workspaces;
  if (!workspaces || typeof workspaces !== "object") {
    return { workspaces: {} };
  }
  const cleaned: WorkspacePreferencesFile["workspaces"] = {};
  for (const [key, value] of Object.entries(workspaces)) {
    if (value && typeof value === "object" && typeof value.hiddenFromRail === "boolean") {
      cleaned[key] = { hiddenFromRail: value.hiddenFromRail };
    }
  }
  return { workspaces: cleaned };
}

async function readFromDisk(): Promise<WorkspacePreferencesFile> {
  try {
    const filePath = await preferencesFilePath();
    if (!(await exists(filePath))) {
      return { workspaces: {} };
    }
    const raw = await readTextFile(filePath);
    return normalizeFile(JSON.parse(raw));
  } catch {
    return { workspaces: {} };
  }
}

async function writeToDisk(prefs: WorkspacePreferencesFile): Promise<void> {
  try {
    const filePath = await preferencesFilePath();
    await writeTextFile(filePath, JSON.stringify(prefs, null, 2));
  } catch {
    // Preferences are best-effort; a write failure must not crash the app.
  }
}

function emitChange(): void {
  if (!cache) {
    return;
  }
  const hidden = getHiddenRootPathsSnapshot();
  for (const listener of listeners) {
    listener(hidden);
  }
}

function getHiddenRootPathsSnapshot(): Set<string> {
  const snapshot = new Set<string>();
  if (!cache) {
    return snapshot;
  }
  for (const [path, entry] of cache) {
    if (entry.hiddenFromRail) {
      snapshot.add(path);
    }
  }
  return snapshot;
}

/**
 * Loads preferences from disk into the in-memory cache. Safe to call multiple
 * times — subsequent calls reload from disk. Notifies subscribers on change.
 */
export async function loadWorkspacePreferences(): Promise<Set<string>> {
  const file = await readFromDisk();
  cache = new Map(Object.entries(file.workspaces));
  emitChange();
  return getHiddenRootPathsSnapshot();
}

/**
 * Returns the cached set of hidden-from-rail root paths. Returns an empty set
 * when preferences have not been loaded yet (call {@link loadWorkspacePreferences}
 * on startup).
 */
export function getHiddenRootPaths(): Set<string> {
  return getHiddenRootPathsSnapshot();
}

/** Whether `path` (normalized internally) is hidden from the activity rail. */
export function isHiddenFromRail(path: string): boolean {
  if (!cache) {
    return false;
  }
  return cache.get(normalizePathSync(path))?.hiddenFromRail === true;
}

/**
 * Sets the hide-from-rail flag for `path` (normalized internally), persists to
 * disk, and notifies subscribers. Removing the last open workspace leaves a
 * stale entry in the file; that is harmless (it only affects re-adding the same
 * path) and aligned with decision 9 / risk note.
 */
export async function setHiddenFromRail(path: string, hidden: boolean): Promise<void> {
  if (!cache) {
    await loadWorkspacePreferences();
  }
  const key = normalizePathSync(path);
  cache!.set(key, { hiddenFromRail: hidden });
  const file: WorkspacePreferencesFile = {
    workspaces: Object.fromEntries(cache!.entries()),
  };
  await writeToDisk(file);
  emitChange();
}

/**
 * Subscribes to hide-flag changes (load + every {@link setHiddenFromRail}). The
 * listener receives the full hidden-paths snapshot. Returns an unsubscribe
 * function.
 */
export function subscribeWorkspacePreferences(
  listener: (hiddenPaths: Set<string>) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: clears the in-memory cache and listeners. */
export function _resetWorkspacePreferencesForTests(): void {
  cache = null;
  listeners.clear();
}
