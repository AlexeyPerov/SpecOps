import { writable, type Readable, type Writable } from "svelte/store";
import { logDiagnostic } from "../services/logging";
import { createOpencodeBackendFromAppState } from "./backends/opencodeBackendFactory";
import type { WorkspaceAgentBackend } from "./backends/workspaceAgentBackend";

/**
 * M10-T1 — generic factory for the reactive-store pattern that was copy-pasted
 * seven times across the workspace-agent services (`opencodeCatalog`,
 * `opencodeConfigStore`, `opencodeCommands`, `opencodeTodoStore`,
 * `opencodeDiffStore`, `opencodeStatusSummary`, `fileStatusTracker`).
 *
 * The shared skeleton:
 *   1. a per-key cache (`Map<key, TState>`),
 *   2. a per-key inflight dedup (`Map<key, Promise<TState>>`),
 *   3. a diagnostic emitter keyed on a `kind` string,
 *   4. a never-throws refresh: dedup → disabled-check → loading → fetch
 *      (try/finally deleting inflight) → loaded/error.
 *
 * The only per-store variance is: key arity (`keyOf`), the empty state, the
 * diagnostic `kind`/message, the success-state `fetch` callback, the
 * loading/error-state builders, and whether the store is pull-only or exposes a
 * real Svelte `Readable`.
 *
 * ## Reactivity split (deliberate — do not "fix")
 *
 * The **per-session** stores (todo, diff) expose a real Svelte `Readable` so the
 * panels re-render on refresh without polling. The **workspace** stores
 * (catalog, config, commands) are **pull-only** — callers read a snapshot on
 * demand (they're consumed from settings panels that re-mount on open, not from
 * a long-lived `$store` subscription). The status-summary and file-status stores
 * are reactive too (their panels do subscribe). Set `reactive: true` for the
 * former group, `false` for the latter. A future contributor reaching for
 * `.subscribe` on a pull-only store will get a thrown error from `getReadable` —
 * that's intentional, and the message points here.
 */

export interface ReactiveResourceStoreDiagnosticInput {
  reason: string;
  /** The joined cache key (already passed through `keyOf`). */
  key: string;
  level?: "debug" | "warn";
  error?: unknown;
  /** Extra per-store metadata merged into the diagnostic `metadata` blob. */
  extra?: Record<string, unknown>;
}

export interface ReactiveResourceStoreOptions<TState, TKey> {
  /** Human-readable label used in the diagnostic `message` (e.g. "opencode catalog"). */
  diagnosticLabel: string;
  /** Stable diagnostic `kind` (e.g. "opencode.catalog.refresh"). */
  diagnosticKind: string;
  /**
   * Collapses the key tuple to a single cache string. Key arity is the only
   * structural difference between stores (1-arg workspace stores vs 2-arg / 3-arg
   * per-session stores), so the factory takes a tuple and the store supplies its
   * own join.
   */
  keyOf: (key: TKey) => string;
  /** Extra metadata beyond `key`/`reason`/`error` (e.g. `sessionId`). */
  diagnosticExtra?: (key: TKey) => Record<string, unknown>;
  /**
   * Returns a fresh copy of the empty state for a new cache entry, so a consumer
   * mutating a pre-refresh snapshot can't corrupt the singleton across
   * sessions/workspaces (M10-T3). Defaults to a shallow spread of `emptyState`;
   * stores whose state holds a `Map` (file-status) override to allocate a fresh
   * `new Map()`.
   */
  copyEmptyState: () => TState;
  /** State used when OpenCode is disabled (refresh returns immediately). */
  disabledState: () => TState;
  /** Flips a prior snapshot to its loading variant (default: `{ ...prior, status: "loading" }`). */
  buildLoadingState: (prior: TState) => TState;
  /**
   * Builds the error state from the thrown message + the prior snapshot.
   * Default: `{ ...emptyState, status: "error", lastErrorMessage: message }`.
   * The config store overrides to preserve prior cached data on a transient
   * reload failure (M7-T3).
   */
  buildErrorState: (message: string, prior: TState) => TState;
  /**
   * The store-specific fetch. Receives the OpenCode backend (already gated to
   * "enabled") and the key tuple; returns the success state. The factory wraps
   * this in try/catch and converts a throw into the error state + a warn
   * diagnostic.
   */
  fetch: (backend: WorkspaceAgentBackend, key: TKey) => Promise<TState>;
  /** Whether to wrap each cache entry in a real Svelte `Readable`. See above. */
  reactive?: boolean;
}

interface ReactiveEntry<TState> {
  /** Pull-only snapshot (always present). */
  value: TState;
  /** Present only when `reactive: true`. */
  readable?: Readable<TState>;
  set?: (value: TState) => void;
}

/**
 * Creates a reactive resource store. See `ReactiveResourceStoreOptions` for the
 * per-store variance. The returned object is the shared skeleton; each concrete
 * store wraps it with its own typed accessors (`getOpencodeCatalog`, etc.).
 */
export function createReactiveResourceStore<TState, TKey>(
  opts: ReactiveResourceStoreOptions<TState, TKey>,
): {
  getSnapshot: (key: TKey) => TState;
  getReadable: (key: TKey) => Readable<TState>;
  refresh: (key: TKey) => Promise<TState>;
  clear: (key: TKey) => void;
  resetForTests: () => void;
  /** Direct cache writer for stores that mutate slices outside refresh (config). */
  setSnapshot: (key: TKey, state: TState) => void;
} {
  const reactive = opts.reactive ?? false;
  const cache = new Map<string, ReactiveEntry<TState>>();
  const inflight = new Map<string, Promise<TState>>();

  function getOrCreateEntry(key: TKey): ReactiveEntry<TState> {
    const cacheKey = opts.keyOf(key);
    const existing = cache.get(cacheKey);
    if (existing) {
      return existing;
    }
    const value = opts.copyEmptyState();
    if (reactive) {
      const store: Writable<TState> = writable<TState>(value);
      const entry: ReactiveEntry<TState> = {
        value,
        readable: { subscribe: store.subscribe },
        set: store.set,
      };
      cache.set(cacheKey, entry);
      return entry;
    }
    const entry: ReactiveEntry<TState> = { value };
    cache.set(cacheKey, entry);
    return entry;
  }

  function setEntryState(key: TKey, state: TState): void {
    const entry = getOrCreateEntry(key);
    entry.value = state;
    entry.set?.(state);
  }

  function emitDiagnostic(input: ReactiveResourceStoreDiagnosticInput): void {
    void logDiagnostic({
      level: input.level ?? "debug",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: `${opts.diagnosticLabel} refresh`,
      metadata: {
        kind: opts.diagnosticKind,
        reason: input.reason,
        key: input.key,
        error: input.error instanceof Error ? input.error.message : undefined,
        ...input.extra,
      },
    });
  }

  function getSnapshot(key: TKey): TState {
    return getOrCreateEntry(key).value;
  }

  function getReadable(key: TKey): Readable<TState> {
    if (!reactive) {
      throw new Error(
        `createReactiveResourceStore("${opts.diagnosticKind}"): store is pull-only; ` +
          `call getSnapshot() instead of getReadable(). See the reactivity note in ` +
          `opencodeResourceStore.ts.`,
      );
    }
    return getOrCreateEntry(key).readable!;
  }

  function setSnapshot(key: TKey, state: TState): void {
    setEntryState(key, state);
  }

  async function refresh(key: TKey): Promise<TState> {
    const cacheKey = opts.keyOf(key);
    const extra = opts.diagnosticExtra?.(key);
    const existing = inflight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const backend = createOpencodeBackendFromAppState();
    if (!backend) {
      const disabled = opts.disabledState();
      setEntryState(key, disabled);
      return disabled;
    }

    setEntryState(key, opts.buildLoadingState(getSnapshot(key)));

    const promise = (async (): Promise<TState> => {
      try {
        const state = await opts.fetch(backend, key);
        setEntryState(key, state);
        emitDiagnostic({ reason: "loaded", key: cacheKey, extra });
        return state;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : `${opts.diagnosticLabel} failed.`;
        const prior = getSnapshot(key);
        const errorState = opts.buildErrorState(message, prior);
        setEntryState(key, errorState);
        emitDiagnostic({ reason: "error", key: cacheKey, level: "warn", error, extra });
        return errorState;
      } finally {
        inflight.delete(cacheKey);
      }
    })();

    inflight.set(cacheKey, promise);
    return promise;
  }

  function clear(key: TKey): void {
    const cacheKey = opts.keyOf(key);
    cache.delete(cacheKey);
    inflight.delete(cacheKey);
  }

  function resetForTests(): void {
    cache.clear();
    inflight.clear();
  }

  return { getSnapshot, getReadable, refresh, clear, resetForTests, setSnapshot };
}
