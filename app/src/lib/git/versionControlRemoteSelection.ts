import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ensureSpecOpsDataDir } from "../services/appDataDir";
import { resolveDefaultRemote } from "./gitParse";
import type { GitRemote } from "./types";
import { normalizeGitOutputPath } from "./types";

/** User-selected remote target for fetch/pull/push toolbar actions. */
export interface VersionControlRemoteSelection {
  /** Configured remote name, or null when unset / no remotes. */
  remoteName: string | null;
  /** Optional branch on the selected remote (reserved for follow-up UI). */
  remoteBranch: string | null;
}

export interface PersistedRemoteSelectionByRepo {
  version: 1;
  updatedAt: string;
  /** Normalized repo root path → last toolbar remote selection. */
  byRepo: Record<string, VersionControlRemoteSelection>;
}

const FILE_NAME = "version-control-remote-selection.json";

export const emptyRemoteSelection = (): VersionControlRemoteSelection => ({
  remoteName: null,
  remoteBranch: null,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Parse one persisted selection object from JSON. */
export function parsePersistedRemoteSelection(value: unknown): VersionControlRemoteSelection | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    remoteName: normalizeOptionalString(value.remoteName),
    remoteBranch: normalizeOptionalString(value.remoteBranch),
  };
}

/** Serialize selection for persistence (drops empty strings). */
export function serializeRemoteSelection(
  selection: VersionControlRemoteSelection,
): VersionControlRemoteSelection {
  return {
    remoteName: normalizeOptionalString(selection.remoteName),
    remoteBranch: normalizeOptionalString(selection.remoteBranch),
  };
}

function repoPersistenceKey(repoRoot: string): string {
  return normalizeGitOutputPath(repoRoot);
}

function remoteNames(remotes: readonly GitRemote[]): Set<string> {
  return new Set(remotes.map((remote) => remote.name));
}

/**
 * Resolve the default remote name (`origin`, then first configured remote).
 * Returns null when no remotes exist.
 */
export function resolveDefaultRemoteName(remotes: readonly GitRemote[]): string | null {
  return resolveDefaultRemote([...remotes])?.name ?? null;
}

/**
 * Derive a valid toolbar selection after remotes refresh or persistence restore.
 * Falls back to `origin` then the first remote when stored selection is missing
 * or no longer configured.
 */
export function reconcileRemoteSelection(
  stored: VersionControlRemoteSelection | null | undefined,
  remotes: readonly GitRemote[],
): VersionControlRemoteSelection {
  if (remotes.length === 0) {
    return emptyRemoteSelection();
  }

  const names = remoteNames(remotes);
  const storedRemote = normalizeOptionalString(stored?.remoteName);
  const storedBranch = normalizeOptionalString(stored?.remoteBranch);

  let remoteName: string | null = null;
  let remoteBranch: string | null = null;

  if (storedRemote && names.has(storedRemote)) {
    remoteName = storedRemote;
    remoteBranch = storedBranch;
  } else {
    remoteName = resolveDefaultRemoteName(remotes);
    remoteBranch = null;
  }

  return { remoteName, remoteBranch };
}

/**
 * Remote name to pass to git fetch/pull/push, or undefined to keep upstream-only
 * commands (`git fetch`, `git pull`, `git push`).
 */
export function remoteOperationTarget(
  selection: VersionControlRemoteSelection,
  remotes: readonly GitRemote[],
): { remoteName: string; remoteBranch: string | null } | undefined {
  const reconciled = reconcileRemoteSelection(selection, remotes);
  if (!reconciled.remoteName) {
    return undefined;
  }
  return {
    remoteName: reconciled.remoteName,
    remoteBranch: reconciled.remoteBranch,
  };
}

async function getPrefsPath(): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  return join(base, FILE_NAME);
}

function parseSnapshot(raw: string): PersistedRemoteSelectionByRepo | null {
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      updatedAt?: unknown;
      byRepo?: unknown;
    };
    if (parsed.version !== 1 || typeof parsed.updatedAt !== "string" || !isRecord(parsed.byRepo)) {
      return null;
    }

    const byRepo: Record<string, VersionControlRemoteSelection> = {};
    for (const [repoKey, value] of Object.entries(parsed.byRepo)) {
      const selection = parsePersistedRemoteSelection(value);
      if (selection) {
        byRepo[normalizeGitOutputPath(repoKey)] = selection;
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

async function readSnapshot(): Promise<PersistedRemoteSelectionByRepo | null> {
  try {
    const prefsPath = await getPrefsPath();
    const raw = await readTextFile(prefsPath);
    return parseSnapshot(raw);
  } catch {
    return null;
  }
}

async function writeSnapshot(snapshot: PersistedRemoteSelectionByRepo): Promise<void> {
  const prefsPath = await getPrefsPath();
  await writeTextFile(prefsPath, JSON.stringify(snapshot, null, 2));
}

async function loadOrCreateSnapshot(): Promise<PersistedRemoteSelectionByRepo> {
  return (
    (await readSnapshot()) ?? {
      version: 1 as const,
      updatedAt: new Date().toISOString(),
      byRepo: {},
    }
  );
}

/** Read persisted toolbar remote selection for a repository root. */
export async function readPersistedRemoteSelection(
  repoRoot: string,
): Promise<VersionControlRemoteSelection | null> {
  const snapshot = await readSnapshot();
  if (!snapshot) {
    return null;
  }
  return snapshot.byRepo[repoPersistenceKey(repoRoot)] ?? null;
}

/** Persist toolbar remote selection for a repository root. */
export async function writePersistedRemoteSelection(
  repoRoot: string,
  selection: VersionControlRemoteSelection,
): Promise<void> {
  const snapshot = await loadOrCreateSnapshot();
  const key = repoPersistenceKey(repoRoot);
  const serialized = serializeRemoteSelection(selection);

  if (!serialized.remoteName && !serialized.remoteBranch) {
    delete snapshot.byRepo[key];
  } else {
    snapshot.byRepo[key] = serialized;
  }

  snapshot.updatedAt = new Date().toISOString();
  await writeSnapshot(snapshot);
}

/** Test helper — parse a full persisted snapshot JSON string. */
export function parsePersistedRemoteSelectionSnapshot(
  raw: string,
): PersistedRemoteSelectionByRepo | null {
  return parseSnapshot(raw);
}
