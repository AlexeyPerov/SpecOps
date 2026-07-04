import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ensureSpecOpsDataDir } from "../services/appDataDir";
import {
  DEFAULT_HISTORY_FILTER_MODE,
  type HistoryFilterMode,
} from "./types";
import { normalizeGitOutputPath } from "./types";

export interface HistoryFilterModeOption {
  value: HistoryFilterMode;
  label: string;
  title: string;
}

/** Toolbar labels for history scope modes (D-10). */
export const HISTORY_FILTER_MODE_OPTIONS: readonly HistoryFilterModeOption[] = [
  {
    value: "current-branch",
    label: "Branch",
    title: "Commits reachable from the current branch",
  },
  {
    value: "all-branches",
    label: "All branches",
    title: "Commits on all local branches",
  },
  {
    value: "all-branches-and-remotes",
    label: "All + remotes",
    title: "All local branches and remote-tracking refs",
  },
];

export const HISTORY_FILTER_MODE_VALUES: readonly HistoryFilterMode[] =
  HISTORY_FILTER_MODE_OPTIONS.map((option) => option.value);

export interface PersistedHistoryFilterByRepo {
  version: 1;
  updatedAt: string;
  /** Normalized repo root path → last history filter mode. */
  byRepo: Record<string, HistoryFilterMode>;
}

const FILE_NAME = "version-control-history-filter.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function repoPersistenceKey(repoRoot: string): string {
  return normalizeGitOutputPath(repoRoot);
}

/** Parse one persisted filter mode value from JSON. */
export function parsePersistedHistoryFilterMode(value: unknown): HistoryFilterMode | null {
  if (typeof value !== "string") {
    return null;
  }
  return HISTORY_FILTER_MODE_VALUES.includes(value as HistoryFilterMode)
    ? (value as HistoryFilterMode)
    : null;
}

/** Resolve stored mode with default fallback. */
export function reconcileHistoryFilterMode(
  stored: HistoryFilterMode | null | undefined,
): HistoryFilterMode {
  return parsePersistedHistoryFilterMode(stored) ?? DEFAULT_HISTORY_FILTER_MODE;
}

async function getPrefsPath(): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  return join(base, FILE_NAME);
}

function parseSnapshot(raw: string): PersistedHistoryFilterByRepo | null {
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      updatedAt?: unknown;
      byRepo?: unknown;
    };
    if (parsed.version !== 1 || typeof parsed.updatedAt !== "string" || !isRecord(parsed.byRepo)) {
      return null;
    }

    const byRepo: Record<string, HistoryFilterMode> = {};
    for (const [repoKey, value] of Object.entries(parsed.byRepo)) {
      const mode = parsePersistedHistoryFilterMode(value);
      if (mode) {
        byRepo[normalizeGitOutputPath(repoKey)] = mode;
      }
    }

    return {
      version: 1,
      updatedAt: parsed.updatedAt,
      byRepo,
    };
  } catch {
    return null;
  }
}

async function readSnapshot(): Promise<PersistedHistoryFilterByRepo | null> {
  try {
    const prefsPath = await getPrefsPath();
    const raw = await readTextFile(prefsPath);
    return parseSnapshot(raw);
  } catch {
    return null;
  }
}

async function writeSnapshot(snapshot: PersistedHistoryFilterByRepo): Promise<void> {
  const prefsPath = await getPrefsPath();
  await writeTextFile(prefsPath, JSON.stringify(snapshot, null, 2));
}

async function loadOrCreateSnapshot(): Promise<PersistedHistoryFilterByRepo> {
  return (
    (await readSnapshot()) ?? {
      version: 1 as const,
      updatedAt: new Date().toISOString(),
      byRepo: {},
    }
  );
}

/** Read persisted history filter mode for a repository root. */
export async function readPersistedHistoryFilterMode(
  repoRoot: string,
): Promise<HistoryFilterMode | null> {
  const snapshot = await readSnapshot();
  if (!snapshot) {
    return null;
  }
  return snapshot.byRepo[repoPersistenceKey(repoRoot)] ?? null;
}

/** Persist history filter mode for a repository root. */
export async function writePersistedHistoryFilterMode(
  repoRoot: string,
  filterMode: HistoryFilterMode,
): Promise<void> {
  const snapshot = await loadOrCreateSnapshot();
  const key = repoPersistenceKey(repoRoot);
  const mode = parsePersistedHistoryFilterMode(filterMode) ?? DEFAULT_HISTORY_FILTER_MODE;

  if (mode === DEFAULT_HISTORY_FILTER_MODE) {
    delete snapshot.byRepo[key];
  } else {
    snapshot.byRepo[key] = mode;
  }

  snapshot.updatedAt = new Date().toISOString();
  await writeSnapshot(snapshot);
}

/** Test helper — parse a full persisted snapshot JSON string. */
export function parsePersistedHistoryFilterSnapshot(
  raw: string,
): PersistedHistoryFilterByRepo | null {
  return parseSnapshot(raw);
}
