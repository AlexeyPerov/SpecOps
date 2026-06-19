/**
 * Per-workspace prompt history (M3-T4).
 *
 * Arrow-up / arrow-down cycles through previous prompts (frecency-ordered);
 * history is capped at the last N entries and persisted to a JSON file under
 * the SpecOps data dir so it survives restarts.
 *
 * Persistence is best-effort: any read/write failure degrades to an in-memory
 * history for the session. We never throw from the public API so a broken
 * history file can't block the composer.
 */

import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ensureSpecOpsDataDir } from "./appDataDir";
import { normalizePathSync } from "./diskFingerprint";
import { logDiagnostic } from "./logging";

const HISTORY_DIR_NAME = "prompt-history";
const MAX_ENTRIES_DEFAULT = 100;
const CURRENT_VERSION = 1;

export interface PromptHistoryEntry {
  /** Trimmed prompt text. Acts as the dedupe key. */
  prompt: string;
  /** First-seen ISO timestamp (for recency tiebreaks). */
  firstSeenAt: string;
  /** Last-used ISO timestamp (drives frequency + recency score). */
  lastUsedAt: string;
  /** Number of times this prompt was sent. */
  count: number;
}

export interface PromptHistoryFile {
  version: 1;
  updatedAt: string;
  entries: PromptHistoryEntry[];
}

export interface PromptHistoryConfig {
  maxEntries?: number;
  /** Injectable clock (testing). Defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * In-memory working copy for the active workspace. Tests can bypass the disk
 * layer by using {@link createPromptHistoryStore} with a no-op persistence
 * shim.
 */
export interface PromptHistoryStore {
  /** Returns the frecency-ordered history (most relevant first). */
  list(): PromptHistoryEntry[];
  /** Records a sent prompt (or no-ops on empty / duplicate-most-recent). */
  record(prompt: string): void;
  /** Removes a single entry by its (exact) prompt text. */
  remove(prompt: string): void;
  /** Clears all history for this workspace. */
  clear(): void;
}

export function parseHistoryFile(raw: string): PromptHistoryFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1 || !Array.isArray(obj.entries)) {
    return null;
  }
  const entries: PromptHistoryEntry[] = [];
  for (const entry of obj.entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (
      typeof e.prompt !== "string" ||
      typeof e.firstSeenAt !== "string" ||
      typeof e.lastUsedAt !== "string" ||
      typeof e.count !== "number"
    ) {
      continue;
    }
    if (e.prompt.trim().length === 0) {
      continue;
    }
    entries.push({
      prompt: e.prompt,
      firstSeenAt: e.firstSeenAt,
      lastUsedAt: e.lastUsedAt,
      count: e.count,
    });
  }
  return {
    version: CURRENT_VERSION,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
    entries,
  };
}

interface PersistenceShim {
  load(): Promise<PromptHistoryFile | null>;
  save(file: PromptHistoryFile): Promise<void>;
}

async function defaultWorkspacePersistence(workspaceRoot: string): Promise<PersistenceShim> {
  const base = await ensureSpecOpsDataDir();
  const dir = await join(base, HISTORY_DIR_NAME);
  const normalized = normalizePathSync(workspaceRoot);
  // Filename uses a sanitized hash of the workspace path so two workspaces
  // never collide. `normalizePathSync` already returns a stable form; we
  // additionally strip path separators for a flat filename.
  const safe = normalized.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 120);
  const file = await join(dir, `${safe || "default"}.json`);
  return {
    async load() {
      try {
        const raw = await readTextFile(file);
        return parseHistoryFile(raw);
      } catch {
        return null;
      }
    },
    async save(payload) {
      try {
        await writeTextFile(file, JSON.stringify(payload, null, 2));
      } catch (error: unknown) {
        void logDiagnostic({
          level: "warn",
          source: "frontend",
          timestamp: new Date().toISOString(),
          message: "prompt history write failed",
          metadata: {
            kind: "prompt.history.write",
            workspaceRoot,
            error: error instanceof Error ? error.message : undefined,
          },
        });
      }
    },
  };
}

/**
 * Create a per-workspace prompt-history store. Loads the existing history from
 * disk asynchronously; the returned store is immediately usable (starts empty
 * and fills in once load resolves).
 */
export async function loadPromptHistory(
  workspaceRoot: string,
  config?: PromptHistoryConfig,
): Promise<PromptHistoryStore> {
  const persistence = await defaultWorkspacePersistence(workspaceRoot).catch(() => null);
  const initial = persistence ? await persistence.load().catch(() => null) : null;
  const store = createPromptHistoryStore(
    initial?.entries ?? [],
    persistence ?? { load: async () => null, save: async () => {} },
    config,
  );
  return store;
}

/**
 * Factory for tests / in-memory use. Accepts preloaded entries and a
 * persistence shim (the default no-op shim is fine for unit tests).
 */
export function createPromptHistoryStore(
  initial: PromptHistoryEntry[] = [],
  persistence: PersistenceShim = { load: async () => null, save: async () => {} },
  config: PromptHistoryConfig = {},
): PromptHistoryStore {
  const maxEntries = config.maxEntries ?? MAX_ENTRIES_DEFAULT;
  const now = config.now ?? (() => new Date());
  let entries = [...initial];

  function persist(): void {
    const payload: PromptHistoryFile = {
      version: CURRENT_VERSION,
      updatedAt: now().toISOString(),
      entries,
    };
    void persistence.save(payload);
  }

  return {
    list() {
      return [...entries].sort((a, b) => frecencyScore(b, now()) - frecencyScore(a, now()));
    },
    record(prompt) {
      const trimmed = prompt.trim();
      if (trimmed.length === 0) {
        return;
      }
      const ts = now().toISOString();
      const existing = entries.find((entry) => entry.prompt === trimmed);
      if (existing) {
        existing.count += 1;
        existing.lastUsedAt = ts;
      } else {
        entries.push({
          prompt: trimmed,
          firstSeenAt: ts,
          lastUsedAt: ts,
          count: 1,
        });
      }
      // Re-sort + cap (drop least-relevant entries past maxEntries).
      entries = entries
        .sort((a, b) => frecencyScore(b, now()) - frecencyScore(a, now()))
        .slice(0, maxEntries);
      persist();
    },
    remove(prompt) {
      const trimmed = prompt.trim();
      if (trimmed.length === 0) {
        return;
      }
      entries = entries.filter((entry) => entry.prompt !== trimmed);
      persist();
    },
    clear() {
      entries = [];
      persist();
    },
  };
}

/**
 * Frecency score: blends frequency (`count`) with time-decayed recency.
 * Recently-used + frequently-reused prompts float to the top. Higher = more
 * relevant. The exact scale isn't load-bearing — only relative ordering
 * matters.
 */
export function frecencyScore(entry: PromptHistoryEntry, now: Date = new Date()): number {
  const lastMs = Date.parse(entry.lastUsedAt);
  const nowMs = now.getTime();
  const ageDays = Number.isFinite(lastMs) ? Math.max(0, (nowMs - lastMs) / (24 * 60 * 60 * 1000)) : Number.POSITIVE_INFINITY;
  // Recency multiplier: 1.0 today, ~0.5 after a week, ~0.1 after a month,
  // floor 0.01 so older entries aren't fully zeroed out.
  const recency = Math.max(0.01, 1 / (1 + ageDays / 7));
  return entry.count * recency;
}

/**
 * Returns the next prompt when arrow-up is pressed. `currentIndex` is `-1`
 * when the cursor isn't yet in history (the user is at the empty draft);
 * returns the top entry. Reaching the end returns `null` so the composer can
 * stop at the oldest entry.
 */
export function nextHistoryUp(
  entries: readonly PromptHistoryEntry[],
  currentIndex: number,
): { prompt: string | null; index: number } {
  if (entries.length === 0) {
    return { prompt: null, index: -1 };
  }
  if (currentIndex < 0) {
    return { prompt: entries[0]!.prompt, index: 0 };
  }
  const next = currentIndex + 1;
  if (next >= entries.length) {
    return { prompt: entries[entries.length - 1]!.prompt, index: entries.length - 1 };
  }
  return { prompt: entries[next]!.prompt, index: next };
}

/**
 * Returns the previous prompt when arrow-down is pressed. At index 0 the
 * composer returns to the empty draft (`index = -1`); past that returns `null`
 * (no further movement).
 */
export function nextHistoryDown(
  entries: readonly PromptHistoryEntry[],
  currentIndex: number,
): { prompt: string | null; index: number } {
  if (entries.length === 0) {
    return { prompt: null, index: -1 };
  }
  if (currentIndex <= 0) {
    return { prompt: null, index: -1 };
  }
  const next = currentIndex - 1;
  return { prompt: entries[next]!.prompt, index: next };
}
