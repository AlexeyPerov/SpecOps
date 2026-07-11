/**
 * Per-root workspace file catalog registry.
 *
 * Maintains one {@link WorkspaceFileCatalog} per normalized workspace root so
 * that workspace switches cannot leak candidates from a prior workspace, while
 * revisiting a recently-used root restores its cached catalog without a fresh
 * enumeration. Each catalog owns its own generation/cancellation lifecycle; the
 * registry is responsible only for routing events to the right catalog and
 * disposing catalogs when their root closes.
 */

import { normalizePathSync } from "./diskFingerprint";
import type { FileWatcherEventKind } from "./fileWatcher";
import {
  createWorkspaceFileCatalog,
  type WorkspaceFileCatalog,
  type WorkspaceFileCatalogDeps,
  type WorkspaceFileCatalogDiagnostics,
  type WorkspaceFileCatalogSnapshot,
} from "./workspaceFileCatalog";

export interface WorkspaceFileCatalogRegistryDeps extends WorkspaceFileCatalogDeps {}

export interface WorkspaceFileCatalogRegistry {
  /** Returns the catalog for `root`, creating one on first use. Null clears the active root. */
  setActiveRoot(root: string | null): WorkspaceFileCatalog;
  /** Returns the currently active catalog, or null when no root is active. */
  getActive(): WorkspaceFileCatalog | null;
  /** Returns the active catalog snapshot, or an idle snapshot when none is active. */
  getActiveSnapshot(): WorkspaceFileCatalogSnapshot;
  /** Returns the active catalog diagnostics, or null when none is active. */
  getActiveDiagnostics(): WorkspaceFileCatalogDiagnostics | null;
  /** Watcher hint forwarded to the active catalog. */
  notifyFilesystemChange(changedPath?: string, kind?: FileWatcherEventKind): void;
  /** Force a rebuild of the active catalog. */
  refresh(): void;
  /** Dispose a single root's catalog (e.g. when its workspace closes). */
  disposeRoot(root: string): void;
  /** Dispose all catalogs and reset. */
  dispose(): void;
}

const IDLE_SNAPSHOT: Readonly<WorkspaceFileCatalogSnapshot> = Object.freeze({
  workspaceRoot: null,
  generation: 0,
  status: "idle",
  entries: [],
  partialErrors: [],
  errorMessage: null,
});

export function createWorkspaceFileCatalogRegistry(
  deps: WorkspaceFileCatalogRegistryDeps = {},
): WorkspaceFileCatalogRegistry {
  const catalogs = new Map<string, WorkspaceFileCatalog>();
  let activeKey: string | null = null;

  function keyFor(root: string): string {
    return normalizePathSync(root);
  }

  function ensureCatalog(key: string, root: string): WorkspaceFileCatalog {
    const existing = catalogs.get(key);
    if (existing) {
      return existing;
    }
    const catalog = createWorkspaceFileCatalog(deps);
    catalog.setWorkspaceRoot(root);
    catalogs.set(key, catalog);
    return catalog;
  }

  return {
    setActiveRoot(root) {
      if (!root) {
        // Deactivate without destroying — revisiting the root reuses the cache.
        activeKey = null;
        // Return a disposed-looking stub is avoided: callers should check
        // getActive(). Instead return a fresh idle catalog handle that is not
        // retained, mirroring the prior single-catalog "clear" semantics.
        return IDLE_CATALOG;
      }
      const key = keyFor(root);
      activeKey = key;
      return ensureCatalog(key, root);
    },

    getActive() {
      if (!activeKey) {
        return null;
      }
      return catalogs.get(activeKey) ?? null;
    },

    getActiveSnapshot() {
      return this.getActive()?.getSnapshot() ?? IDLE_SNAPSHOT;
    },

    getActiveDiagnostics() {
      return this.getActive()?.getDiagnostics() ?? null;
    },

    notifyFilesystemChange(changedPath, kind) {
      this.getActive()?.notifyFilesystemChange(changedPath, kind);
    },

    refresh() {
      this.getActive()?.refresh();
    },

    disposeRoot(root) {
      const key = keyFor(root);
      const catalog = catalogs.get(key);
      if (!catalog) {
        return;
      }
      catalog.dispose();
      catalogs.delete(key);
      if (activeKey === key) {
        activeKey = null;
      }
    },

    dispose() {
      for (const catalog of catalogs.values()) {
        catalog.dispose();
      }
      catalogs.clear();
      activeKey = null;
    },
  };
}

/**
 * Sentinel idle catalog returned when the active root is cleared. Exposes the
 * catalog interface but always reports an idle snapshot and ignores mutation,
 * so consumers can hold a non-null reference during transient "no workspace"
 * states without special-casing null.
 */
const IDLE_CATALOG: WorkspaceFileCatalog = {
  getSnapshot: () => IDLE_SNAPSHOT,
  getOpenablePaths: () => null,
  subscribe: () => () => {},
  setWorkspaceRoot: () => {},
  refresh: () => {},
  notifyFilesystemChange: () => {},
  getDiagnostics: () => ({
    workspaceRoot: null,
    generation: 0,
    status: "idle",
    entryCount: 0,
    partialErrorCount: 0,
    incrementalAdds: 0,
    incrementalRemoves: 0,
    debouncedRebuilds: 0,
  }),
  dispose: () => {},
};
