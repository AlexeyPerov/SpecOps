import { normalizePathForStorage, normalizePathSync } from "./diskFingerprint";
import { mapWithConcurrency } from "./mapWithConcurrency";
import { loadDirectoryChildren, type ProjectTreeNode } from "./projectTree";

export interface ProjectTreeControllerState {
  rootNodes: ProjectTreeNode[];
  childrenByPath: Map<string, ProjectTreeNode[]>;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  showHidden: boolean;
}

export interface ProjectTreeControllerDeps {
  loadDirectoryChildrenFn?: typeof loadDirectoryChildren;
  probeWorkspaceReadAccessFn?: (
    workspaceRoot: string,
  ) => Promise<"ready" | "blocked" | "unknown">;
  /** Maximum workspace tree snapshots retained in memory. Default: 6. */
  maxCachedRoots?: number;
  /**
   * Fired (debounced by publish coalescing) when the expanded-folder set of the
   * currently loaded workspace root changes, so callers can persist it per
   * workspace. Only invoked when a root is loaded and the sorted expansion
   * signature actually differs from the last report.
   */
  onExpandedPathsChange?: (workspaceRoot: string, paths: string[]) => void;
  /**
   * Drops shared directory-listing caches for the given directories. Called at
   * the start of a revalidation pass: the tree reads through a cached
   * `loadDirectoryChildren`, so without this the pass would re-read its own
   * cache and conclude that nothing changed.
   */
  invalidateDirectoryCache?: (directoryPaths: readonly string[]) => void;
}

export interface LoadProjectTreeRootOptions {
  workspaceRoot: string | null;
  isSessionTabActive: boolean;
  onWorkspaceBlocked?: () => void;
  force?: boolean;
}

function createInitialState(showHidden = true): ProjectTreeControllerState {
  return {
    rootNodes: [],
    childrenByPath: new Map<string, ProjectTreeNode[]>(),
    expandedPaths: new Set<string>(),
    loadingPaths: new Set<string>(),
    showHidden,
  };
}

function cloneState(state: ProjectTreeControllerState): ProjectTreeControllerState {
  return {
    rootNodes: [...state.rootNodes],
    childrenByPath: new Map(state.childrenByPath),
    expandedPaths: new Set(state.expandedPaths),
    loadingPaths: new Set(state.loadingPaths),
    showHidden: state.showHidden,
  };
}

/**
 * Case-folded (on macOS/Windows) key used for containment checks, cache
 * bookkeeping and de-duplication. Never use it as a key into `childrenByPath` /
 * `expandedPaths`: those are spelled exactly as the tree rows are — see
 * {@link normalizeDisplayPath}.
 */
function normalizePathForComparison(path: string): string {
  return normalizePathSync(path).replace(/\/+$/, "");
}

/** Case-preserving form: how tree rows, and therefore tree map keys, spell a path. */
function normalizeDisplayPath(path: string): string {
  return normalizePathForStorage(path).replace(/\/+$/, "");
}

function isPathInsideRoot(path: string, workspaceRoot: string): boolean {
  const normalizedPath = normalizePathForComparison(path);
  const normalizedRoot = normalizePathForComparison(workspaceRoot);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function expandedAncestorPathsForFile(
  workspaceRoot: string,
  activePath: string,
): string[] {
  const normalizedRoot = normalizePathForComparison(workspaceRoot);
  const normalizedPath = normalizePathForComparison(activePath);
  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return [];
  }
  // Containment is decided on the case-folded keys, but these ancestors are fed
  // back into `expandedPaths` / `childrenByPath`, so they must carry the tree's
  // own spelling: slice the case-preserving form (same segment layout).
  const displayRoot = normalizeDisplayPath(workspaceRoot);
  const relative = normalizeDisplayPath(activePath).slice(displayRoot.length + 1);
  const parts = relative.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return [];
  }
  const paths: string[] = [];
  let cursor = displayRoot;
  for (const part of parts.slice(0, -1)) {
    cursor = `${cursor}/${part}`;
    paths.push(cursor);
  }
  return paths;
}

const FILESYSTEM_CHANGE_DEBOUNCE_MS = 400;
/**
 * Cooldown during which a directory just reloaded authoritatively (e.g. by the
 * immediate post-mutation `reloadDirectories`) is treated as fresh and skipped
 * by the debounced filesystem-change flush. The in-app mutation path and the OS
 * file watcher both emit a change for the same renamed path; without this guard
 * the watcher's ~400ms-later flush would reload dirs that were just reloaded,
 * causing the project tree to visibly re-render a second time after a drag-drop.
 */
const RELOAD_FRESH_COOLDOWN_MS = 500;

/**
 * Minimum gap between two automatic revalidation passes (window focus,
 * workspace switch) of the same loaded tree. Focus fires on every window
 * activation — including the rapid back-and-forth of alt-tabbing — and a
 * workspace switch can follow one immediately, so without this the tree would
 * re-list its whole expanded set several times a second.
 */
const REVALIDATE_MIN_INTERVAL_MS = 2000;

/** Directory listings read in parallel during one revalidation pass. */
const REVALIDATE_CONCURRENCY = 4;

/**
 * Order-sensitive fingerprint of one directory listing. Two listings with equal
 * signatures are indistinguishable in the tree, so a revalidation that produces
 * only equal signatures publishes nothing and the UI never re-renders.
 */
function listingSignature(nodes: readonly ProjectTreeNode[]): string {
  let signature = "";
  for (const node of nodes) {
    signature += `${node.kind === "directory" ? "d" : "f"}\u0001${node.name}\u0002`;
  }
  return signature;
}

function parentDirectoryPath(path: string): string {
  const normalized = normalizePathForComparison(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return normalized;
  }
  return normalized.slice(0, slash);
}

/**
 * Directories whose cached listings must be dropped for a filesystem change,
 * regardless of tree expansion. Always includes the parent of the changed path
 * (and the path itself when it is an expanded/known directory).
 */
export function directoriesToInvalidateForChange(
  workspaceRoot: string,
  changedPath: string,
): string[] {
  const normalizedRoot = normalizePathForComparison(workspaceRoot);
  const normalizedChanged = normalizePathForComparison(changedPath);
  if (
    normalizedChanged !== normalizedRoot &&
    !normalizedChanged.startsWith(`${normalizedRoot}/`)
  ) {
    return [];
  }

  const dirs = new Set<string>();
  dirs.add(normalizedRoot);
  if (normalizedChanged === normalizedRoot) {
    return [...dirs];
  }
  const parent = parentDirectoryPath(normalizedChanged);
  dirs.add(parent);
  dirs.add(normalizedChanged);
  return [...dirs];
}

/**
 * Directories the project-tree UI should reload for a filesystem change.
 * Only parents that are the workspace root or currently expanded are included,
 * so collapsed branches are not fetched into the tree view.
 *
 * Returns comparison-form paths. `expandedPaths` holds the tree's own spelling,
 * so membership is tested on the folded keys — comparing a folded parent
 * against the raw set matched nothing on macOS/Windows for any path with an
 * uppercase segment (which, with `/Users/...`, is every path), and the change
 * was silently dropped.
 */
export function directoriesToRefreshForChange(
  workspaceRoot: string,
  changedPath: string,
  expandedPaths: ReadonlySet<string>,
): string[] {
  const normalizedRoot = normalizePathForComparison(workspaceRoot);
  const normalizedChanged = normalizePathForComparison(changedPath);
  if (
    normalizedChanged !== normalizedRoot &&
    !normalizedChanged.startsWith(`${normalizedRoot}/`)
  ) {
    return [];
  }

  const expandedKeys = new Set<string>();
  for (const path of expandedPaths) {
    expandedKeys.add(normalizePathForComparison(path));
  }
  const dirs = new Set<string>();
  const parent = parentDirectoryPath(normalizedChanged);
  if (parent === normalizedRoot || expandedKeys.has(parent)) {
    dirs.add(parent);
  }
  if (expandedKeys.has(normalizedChanged)) {
    dirs.add(normalizedChanged);
  }
  if (normalizedChanged !== normalizedRoot && parent !== normalizedRoot) {
    const grandparent = parentDirectoryPath(parent);
    if (grandparent === normalizedRoot || expandedKeys.has(grandparent)) {
      dirs.add(grandparent);
    }
  }
  return [...dirs];
}

export function createProjectTreeController(
  onStateChange: (state: ProjectTreeControllerState) => void,
  deps: ProjectTreeControllerDeps = {},
): {
  getState: () => ProjectTreeControllerState;
  collapseAll: () => void;
  setShowHidden: (next: boolean) => void;
  loadProjectTreeRoot: (options: LoadProjectTreeRootOptions) => Promise<void>;
  loadProjectTreeChildren: (workspaceRoot: string | null, directoryPath: string) => Promise<void>;
  handleToggleProjectTreeDirectory: (workspaceRoot: string | null, path: string) => Promise<void>;
  refreshProjectTree: (workspaceRoot: string | null, isSessionTabActive: boolean) => Promise<void>;
  revalidateProjectTree: (
    workspaceRoot: string | null,
    options?: { force?: boolean },
  ) => Promise<boolean>;
  ensureExpandedForActiveFile: (
    workspaceRoot: string | null,
    activePath: string | null,
  ) => Promise<void>;
  restoreExpandedPaths: (
    workspaceRoot: string | null,
    paths: readonly string[],
  ) => Promise<void>;
  handleFilesystemChange: (workspaceRoot: string | null, changedPath: string) => void;
  reloadDirectories: (workspaceRoot: string | null, directoryPaths: string[]) => Promise<void>;
  clearFilesystemChangeDebounce: () => void;
  getCachedRootCount: () => number;
} {
  const loadChildren = deps.loadDirectoryChildrenFn ?? loadDirectoryChildren;
  const probeAccess = deps.probeWorkspaceReadAccessFn;
  const onExpandedPathsChange = deps.onExpandedPathsChange;
  const invalidateDirectoryCache = deps.invalidateDirectoryCache;
  let state = createInitialState();
  let lastLoadedWorkspaceRoot: string | null = null;
  /**
   * The loaded root in the tree's own spelling. `lastLoadedWorkspaceRoot` is the
   * case-folded comparison key, which cannot be handed to `loadChildren`: the
   * node paths it builds are `${dirPath}/${name}`, so a folded root would mint
   * folded row paths that no longer match `childrenByPath` / `expandedPaths`.
   */
  let lastLoadedWorkspaceRootDisplay: string | null = null;
  /** Bumped on every root load/reset so slower in-flight loads cannot overwrite a newer workspace. */
  let rootLoadGeneration = 0;
  let filesystemChangeTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingFilesystemDirs = new Set<string>();
  /**
   * Normalized directory path → timestamp of its most recent authoritative
   * reload. Used to suppress the debounced filesystem-change flush from
   * re-reloading directories that were just refreshed by an in-app mutation
   * (see {@link RELOAD_FRESH_COOLDOWN_MS}).
   */
  const recentlyReloadedDirs = new Map<string, number>();
  const maxCachedRoots = Math.max(1, deps.maxCachedRoots ?? 6);

  const markDirsFresh = (dirs: readonly string[]): void => {
    const now = Date.now();
    for (const dir of dirs) {
      recentlyReloadedDirs.set(dir, now);
    }
  };

  /**
   * Drops directories whose most recent authoritative reload is still within
   * the freshness cooldown, so the debounced watcher flush does not undo (and
   * re-render) work an in-app mutation just completed. Stale entries are pruned.
   * Returns the directories that should still be reloaded.
   */
  const filterFreshDirs = (dirs: readonly string[]): string[] => {
    const now = Date.now();
    const stale: string[] = [];
    for (const dir of dirs) {
      const reloadedAt = recentlyReloadedDirs.get(dir);
      if (reloadedAt !== undefined && now - reloadedAt < RELOAD_FRESH_COOLDOWN_MS) {
        continue;
      }
      stale.push(dir);
    }
    if (recentlyReloadedDirs.size > 64) {
      for (const [dir, reloadedAt] of recentlyReloadedDirs) {
        if (now - reloadedAt >= RELOAD_FRESH_COOLDOWN_MS) {
          recentlyReloadedDirs.delete(dir);
        }
      }
    }
    return stale;
  };
  /**
   * Last reported sorted signature of `state.expandedPaths` for the loaded
   * workspace. Reset to `null` whenever the loaded root changes so each
   * workspace reports its own expansion once on first publish.
   */
  let lastExpandedSignature: string | null = null;
  /**
   * Set when the loaded workspace root changes. The next publish that actually
   * has root nodes establishes the baseline expansion signature WITHOUT firing
   * the persistence callback — a fresh load's in-memory expansion is empty
   * until {@link restoreExpandedPaths} re-applies the persisted set, and firing
   * `[]` here would clobber the workspace's persisted expansion before the
   * restore reads it.
   */
  let suppressNextExpandedPathsPublish = false;
  type CachedTree = {
    state: ProjectTreeControllerState;
    staleDirectories: Set<string>;
  };
  // Insertion order is LRU order (oldest first).
  const cachedTrees = new Map<string, CachedTree>();

  const touchCachedTree = (workspaceRoot: string, entry: CachedTree): void => {
    cachedTrees.delete(workspaceRoot);
    cachedTrees.set(workspaceRoot, entry);
    while (cachedTrees.size > maxCachedRoots) {
      const oldest = cachedTrees.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      cachedTrees.delete(oldest);
    }
  };

  const cacheActiveState = (): void => {
    if (!lastLoadedWorkspaceRoot || state.rootNodes.length === 0) {
      return;
    }
    const existing = cachedTrees.get(lastLoadedWorkspaceRoot);
    touchCachedTree(lastLoadedWorkspaceRoot, {
      state: {
        ...cloneState(state),
        loadingPaths: new Set(),
      },
      staleDirectories: new Set(existing?.staleDirectories ?? []),
    });
  };

  const publish = (): void => {
    cacheActiveState();
    // Pass the live state reference instead of cloning for the subscriber. The
    // subscriber (+page.svelte) just assigns it to a `$state` variable and
    // reads it reactively — it does not mutate the snapshot, so sharing the
    // reference avoids a full clone of the tree state on every publish (the
    // cache clone above already preserves a frozen copy for re-entry).
    onStateChange(state);
    notifyExpandedPathsChange();
  };

  /**
   * Reports the loaded workspace's expanded-folder set to the persistence
   * callback when it changes. Gated on a root being loaded and on the sorted
   * signature differing from the last report, so the frequent publishes from
   * child loads / refreshes do not spam the caller.
   */
  const notifyExpandedPathsChange = (): void => {
    if (!onExpandedPathsChange || !lastLoadedWorkspaceRoot || state.rootNodes.length === 0) {
      return;
    }
    const signature = [...state.expandedPaths].sort().join("\u0002");
    if (suppressNextExpandedPathsPublish) {
      // First publish after a root switch: adopt the current expansion as the
      // baseline without firing, so a cold load does not clobber persisted
      // expansion with the pre-restore empty set.
      suppressNextExpandedPathsPublish = false;
      lastExpandedSignature = signature;
      return;
    }
    if (signature === lastExpandedSignature) {
      return;
    }
    lastExpandedSignature = signature;
    onExpandedPathsChange(lastLoadedWorkspaceRoot, [...state.expandedPaths]);
  };

  const reset = (): void => {
    cacheActiveState();
    rootLoadGeneration += 1;
    state = createInitialState(state.showHidden);
    lastLoadedWorkspaceRoot = null;
    lastLoadedWorkspaceRootDisplay = null;
    recentlyReloadedDirs.clear();
    lastExpandedSignature = null;
    suppressNextExpandedPathsPublish = false;
    publish();
  };

  let revalidateInFlight = false;
  let lastRevalidateAt = 0;

  const loadProjectTreeChildren = async (
    workspaceRoot: string | null,
    directoryPath: string,
  ): Promise<void> => {
    if (!workspaceRoot || !isPathInsideRoot(directoryPath, workspaceRoot)) {
      return;
    }
    const normalizedRoot = normalizePathForComparison(workspaceRoot);
    if (lastLoadedWorkspaceRoot !== normalizedRoot) {
      return;
    }
    const loadGeneration = rootLoadGeneration;
    state = {
      ...state,
      loadingPaths: new Set([...state.loadingPaths, directoryPath]),
    };
    publish();
    try {
      const children = await loadChildren(workspaceRoot, directoryPath, {
        showHidden: state.showHidden,
      });
      if (
        loadGeneration !== rootLoadGeneration ||
        lastLoadedWorkspaceRoot !== normalizedRoot
      ) {
        return;
      }
      const nextChildren = new Map(state.childrenByPath);
      nextChildren.set(directoryPath, children);
      const nextLoading = new Set(state.loadingPaths);
      nextLoading.delete(directoryPath);
      state = {
        ...state,
        childrenByPath: nextChildren,
        loadingPaths: nextLoading,
      };
      publish();
    } catch (error) {
      if (
        loadGeneration !== rootLoadGeneration ||
        lastLoadedWorkspaceRoot !== normalizedRoot
      ) {
        return;
      }
      const nextLoading = new Set(state.loadingPaths);
      nextLoading.delete(directoryPath);
      state = {
        ...state,
        loadingPaths: nextLoading,
      };
      publish();
      throw error;
    }
  };

  const loadProjectTreeRoot = async ({
    workspaceRoot,
    isSessionTabActive,
    onWorkspaceBlocked,
    force = false,
  }: LoadProjectTreeRootOptions): Promise<void> => {
    if (!workspaceRoot) {
      reset();
      return;
    }
    const normalizedWorkspaceRoot = normalizePathForComparison(workspaceRoot);
    if (
      !force &&
      state.rootNodes.length > 0 &&
      lastLoadedWorkspaceRoot === normalizedWorkspaceRoot
    ) {
      if (isSessionTabActive && probeAccess) {
        const probe = await probeAccess(workspaceRoot);
        if (probe === "blocked") {
          onWorkspaceBlocked?.();
        }
      }
      return;
    }

    cacheActiveState();
    // We are loading a different root (or force-reloading): reset so the new
    // root's first publish reports its own expansion to the change callback
    // instead of suppressing it as "unchanged". The suppress flag ensures that
    // first publish adopts the baseline without firing (see notifyExpandedPathsChange).
    lastExpandedSignature = null;
    suppressNextExpandedPathsPublish = true;
    if (!force) {
      const cached = cachedTrees.get(normalizedWorkspaceRoot);
      if (cached) {
        rootLoadGeneration += 1;
        lastLoadedWorkspaceRoot = normalizedWorkspaceRoot;
        lastLoadedWorkspaceRootDisplay = normalizeDisplayPath(workspaceRoot);
        state = {
          ...cloneState(cached.state),
          showHidden: state.showHidden,
          loadingPaths: new Set(),
        };
        const staleDirectories = [...cached.staleDirectories];
        cached.staleDirectories.clear();
        touchCachedTree(normalizedWorkspaceRoot, cached);
        publish();
        if (staleDirectories.length > 0) {
          void reloadDirectories(workspaceRoot, staleDirectories);
        }
        if (isSessionTabActive && probeAccess) {
          const probe = await probeAccess(workspaceRoot);
          if (probe === "blocked") {
            onWorkspaceBlocked?.();
          }
        }
        return;
      }
    }

    const loadGeneration = ++rootLoadGeneration;
    if (lastLoadedWorkspaceRoot !== normalizedWorkspaceRoot) {
      state = createInitialState(state.showHidden);
      lastLoadedWorkspaceRoot = null;
      lastLoadedWorkspaceRootDisplay = null;
      publish();
    }
    const rootNodes = await loadChildren(workspaceRoot, workspaceRoot, {
      showHidden: state.showHidden,
    });
    // A newer switch/reset won the race — discard this result.
    if (loadGeneration !== rootLoadGeneration) {
      return;
    }
    state = {
      ...state,
      rootNodes,
    };
    lastLoadedWorkspaceRoot = normalizedWorkspaceRoot;
    lastLoadedWorkspaceRootDisplay = normalizeDisplayPath(workspaceRoot);
    // This listing came straight off disk, so the revalidation that follows a
    // workspace switch has nothing to add: seed the throttle window as if a
    // pass had just run. Entering a workspace served from the in-memory cache
    // leaves the window open, which is exactly when revalidation is useful.
    lastRevalidateAt = Date.now();
    publish();

    if (isSessionTabActive && probeAccess) {
      const probe = await probeAccess(workspaceRoot);
      if (loadGeneration !== rootLoadGeneration) {
        return;
      }
      if (probe === "blocked") {
        onWorkspaceBlocked?.();
      }
    }
  };

  /**
   * Re-list one directory and apply the result only if it differs from what is
   * on screen. Used when a folder is expanded again: its listing may have been
   * loaded minutes ago and the revalidation passes only cover the root and the
   * folders that were expanded at the time, so a collapsed folder's cached
   * children can outlive the directory itself. Silent when nothing changed, so
   * re-expanding an unchanged folder never re-renders the tree.
   */
  const revalidateDirectoryListing = async (
    workspaceRoot: string,
    directoryPath: string,
  ): Promise<void> => {
    const normalizedRoot = normalizePathForComparison(workspaceRoot);
    if (lastLoadedWorkspaceRoot !== normalizedRoot) {
      return;
    }
    const key = normalizePathForComparison(directoryPath);
    // Just reloaded (in-app mutation, watcher flush) — that listing is current.
    if (filterFreshDirs([key]).length === 0) {
      return;
    }
    const loadGeneration = rootLoadGeneration;
    const showHiddenAtStart = state.showHidden;
    invalidateDirectoryCache?.([key]);
    let children: ProjectTreeNode[];
    try {
      children = await loadChildren(workspaceRoot, directoryPath, {
        showHidden: showHiddenAtStart,
      });
    } catch {
      return;
    }
    if (
      loadGeneration !== rootLoadGeneration ||
      lastLoadedWorkspaceRoot !== normalizedRoot ||
      state.showHidden !== showHiddenAtStart
    ) {
      return;
    }
    const current = state.childrenByPath.get(directoryPath);
    if (!current || listingSignature(current) === listingSignature(children)) {
      return;
    }
    markDirsFresh([key]);
    const nextChildren = new Map(state.childrenByPath);
    nextChildren.set(directoryPath, children);
    state = {
      ...state,
      childrenByPath: nextChildren,
    };
    publish();
  };

  const handleToggleProjectTreeDirectory = async (
    workspaceRoot: string | null,
    path: string,
  ): Promise<void> => {
    if (state.expandedPaths.has(path)) {
      const nextExpanded = new Set(state.expandedPaths);
      nextExpanded.delete(path);
      state = {
        ...state,
        expandedPaths: nextExpanded,
      };
      publish();
      return;
    }
    const shouldLoadChildren = !state.childrenByPath.has(path);
    state = {
      ...state,
      expandedPaths: new Set([...state.expandedPaths, path]),
    };
    if (!shouldLoadChildren) {
      publish();
      // Show the known children immediately, then quietly check them against
      // disk — they were listed while the folder was open some time ago.
      if (workspaceRoot && isPathInsideRoot(path, workspaceRoot)) {
        void revalidateDirectoryListing(workspaceRoot, path);
      }
      return;
    }
    if (!workspaceRoot || !isPathInsideRoot(path, workspaceRoot)) {
      publish();
      return;
    }
    await loadProjectTreeChildren(workspaceRoot, path);
  };

  const refreshProjectTree = async (
    workspaceRoot: string | null,
    isSessionTabActive: boolean,
  ): Promise<void> => {
    if (!workspaceRoot) {
      return;
    }
    const normalizedRoot = normalizePathForComparison(workspaceRoot);
    if (lastLoadedWorkspaceRoot === normalizedRoot && state.rootNodes.length > 0) {
      // Manual refresh of the loaded tree is a *forced revalidation*, not a
      // rebuild: dropping `childrenByPath` first collapsed every row, which
      // re-rendered the whole panel and let the scroll container clamp
      // `scrollTop` to 0. Callers clear the shared directory cache before this
      // runs, so the re-listings hit disk.
      await revalidateProjectTree(workspaceRoot, { force: true });
      return;
    }
    const expanded = [...state.expandedPaths];
    state = {
      ...state,
      childrenByPath: new Map<string, ProjectTreeNode[]>(),
    };
    publish();
    await loadProjectTreeRoot({
      workspaceRoot,
      isSessionTabActive,
      force: true,
    });
    for (const path of expanded) {
      await loadProjectTreeChildren(workspaceRoot, path);
    }
  };

  /**
   * Quiet refresh of the loaded workspace tree: re-lists the root plus every
   * currently expanded directory and applies only the listings that actually
   * changed, in a single publish.
   *
   * Unlike {@link refreshProjectTree} it never clears `childrenByPath` first, so
   * the tree does not collapse and repopulate (which re-renders every row and
   * lets the scroll container clamp `scrollTop` to 0), and the reads run with
   * bounded concurrency instead of one sequential await per expanded folder.
   * When nothing changed on disk — the common case for a focus event — it
   * publishes nothing at all.
   *
   * Resolves true when tree state was updated.
   */
  const revalidateProjectTree = async (
    workspaceRoot: string | null,
    options: { force?: boolean } = {},
  ): Promise<boolean> => {
    if (!workspaceRoot) {
      return false;
    }
    const normalizedRoot = normalizePathForComparison(workspaceRoot);
    // Only the loaded tree can be revalidated in place; a root that is only in
    // the LRU cache is revalidated when it is next entered.
    if (lastLoadedWorkspaceRoot !== normalizedRoot || state.rootNodes.length === 0) {
      return false;
    }
    // A forced pass (manual refresh, hidden-files toggle) is never dropped for
    // an automatic one already running: both apply against the state as it is
    // after their own listings resolve, so the later apply simply wins.
    if (revalidateInFlight && !options.force) {
      return false;
    }
    const startedAt = Date.now();
    if (!options.force && startedAt - lastRevalidateAt < REVALIDATE_MIN_INTERVAL_MS) {
      return false;
    }
    revalidateInFlight = true;
    lastRevalidateAt = startedAt;
    const loadGeneration = rootLoadGeneration;
    const showHiddenAtStart = state.showHidden;
    // Expanded paths are keyed exactly as the tree rows are (the on-disk
    // casing), so read and write `childrenByPath` with those same keys; only
    // the cache/freshness bookkeeping uses the comparison form.
    const expandedTargets = [...state.expandedPaths].filter(
      (path) =>
        normalizePathForComparison(path) !== normalizedRoot &&
        isPathInsideRoot(path, normalizedRoot),
    );
    const targets = [workspaceRoot, ...expandedTargets];
    const normalizedTargets = [
      ...new Set(targets.map((path) => normalizePathForComparison(path))),
    ];
    try {
      invalidateDirectoryCache?.(normalizedTargets);
      const listings = await mapWithConcurrency(
        targets,
        REVALIDATE_CONCURRENCY,
        async (directoryPath) => {
          try {
            return await loadChildren(workspaceRoot, directoryPath, {
              showHidden: showHiddenAtStart,
            });
          } catch {
            // A directory that vanished or became unreadable between listings
            // is left untouched; the watcher's own change event drops it from
            // the parent listing.
            return null;
          }
        },
      );
      // A workspace switch, manual refresh, or hidden-files toggle that landed
      // while the listings were in flight owns the tree now — discard.
      if (
        loadGeneration !== rootLoadGeneration ||
        lastLoadedWorkspaceRoot !== normalizedRoot ||
        state.showHidden !== showHiddenAtStart
      ) {
        return false;
      }
      let nextRootNodes: ProjectTreeNode[] | null = null;
      let nextChildren: Map<string, ProjectTreeNode[]> | null = null;
      for (const [index, directoryPath] of targets.entries()) {
        const children = listings[index];
        if (!children) {
          continue;
        }
        if (index === 0) {
          if (listingSignature(children) !== listingSignature(state.rootNodes)) {
            nextRootNodes = children;
          }
          continue;
        }
        const current = state.childrenByPath.get(directoryPath);
        if (current && listingSignature(current) === listingSignature(children)) {
          continue;
        }
        nextChildren ??= new Map(state.childrenByPath);
        nextChildren.set(directoryPath, children);
      }
      if (!nextRootNodes && !nextChildren) {
        return false;
      }
      // These listings are authoritative as of now: keep the debounced watcher
      // flush from reloading them again a moment later.
      markDirsFresh(normalizedTargets);
      state = {
        ...state,
        ...(nextRootNodes ? { rootNodes: nextRootNodes } : {}),
        ...(nextChildren ? { childrenByPath: nextChildren } : {}),
      };
      publish();
      return true;
    } finally {
      revalidateInFlight = false;
    }
  };

  const ensureExpandedForActiveFile = async (
    workspaceRoot: string | null,
    activePath: string | null,
  ): Promise<void> => {
    if (!workspaceRoot || !activePath) {
      return;
    }
    const ancestorPaths = expandedAncestorPathsForFile(workspaceRoot, activePath);
    if (ancestorPaths.length === 0) {
      return;
    }
    const ancestorsToExpand = ancestorPaths.filter((ancestorPath) => !state.expandedPaths.has(ancestorPath));
    const ancestorsToLoad = ancestorPaths.filter(
      (ancestorPath) =>
        !state.childrenByPath.has(ancestorPath) && !state.loadingPaths.has(ancestorPath),
    );

    if (ancestorsToExpand.length > 0) {
      const nextExpanded = new Set(state.expandedPaths);
      for (const ancestorPath of ancestorsToExpand) {
        nextExpanded.add(ancestorPath);
      }
      state = {
        ...state,
        expandedPaths: nextExpanded,
      };
    }
    if (ancestorsToLoad.length === 0) {
      if (ancestorsToExpand.length > 0) {
        publish();
      }
      return;
    }

    // Parallelize ancestor directory loads: each `loadProjectTreeChildren` call
    // independently guards on `rootLoadGeneration` and the workspace root, so
    // they are safe to run concurrently. Previously these were sequential,
    // yielding 2 publishes per ancestor level (one to mark loading, one to
    // store children) and N sequential awaits on disk I/O.
    await Promise.all(
      ancestorsToLoad.map((ancestorPath) =>
        loadProjectTreeChildren(workspaceRoot, ancestorPath),
      ),
    );
  };

  /**
   * Re-apply a persisted set of expanded folder paths for the currently loaded
   * workspace (cold-load restore from disk). Idempotent: paths already expanded
   * are skipped, so re-entry to a workspace whose in-memory cache already holds
   * the expansion is a no-op. Stale/deleted persisted folders reject and are
   * swallowed (left expanded-but-empty, matching toggle behavior for a vanished
   * directory) so one bad path cannot abort the rest of the restore.
   */
  const restoreExpandedPaths = async (
    workspaceRoot: string | null,
    paths: readonly string[],
  ): Promise<void> => {
    if (!workspaceRoot || paths.length === 0) {
      return;
    }
    const normalizedRoot = normalizePathForComparison(workspaceRoot);
    if (lastLoadedWorkspaceRoot !== normalizedRoot) {
      return;
    }
    const toExpand = paths
      .filter((path): path is string => typeof path === "string" && path.length > 0)
      .filter((path) => isPathInsideRoot(path, workspaceRoot))
      .filter((path) => !state.expandedPaths.has(path));
    if (toExpand.length === 0) {
      return;
    }
    const nextExpanded = new Set(state.expandedPaths);
    for (const path of toExpand) {
      nextExpanded.add(path);
    }
    const toLoad = toExpand.filter(
      (path) => !state.childrenByPath.has(path) && !state.loadingPaths.has(path),
    );
    state = {
      ...state,
      expandedPaths: nextExpanded,
    };
    // Restoring re-applies paths that are already persisted, so its child-load
    // publishes must not fire the persistence callback. Adopt the post-restore
    // signature as the baseline; a subsequent genuine change (toggle / auto
    // expand) will differ and fire normally.
    lastExpandedSignature = [...nextExpanded].sort().join("\u0002");
    if (toLoad.length === 0) {
      publish();
      return;
    }
    await Promise.all(
      toLoad.map((path) =>
        loadProjectTreeChildren(workspaceRoot, path).catch(() => {
          /* persisted path no longer resolves; leave it expanded-but-empty */
        }),
      ),
    );
  };

  /**
   * The tree's spelling of a workspace root. Callers reach `reloadDirectories`
   * from both sides — the app passes the workspace's real root, the debounced
   * watcher flush passes the folded comparison key — and only the former may be
   * used to build node paths.
   */
  const treeWorkspaceRoot = (workspaceRoot: string): string => {
    if (
      lastLoadedWorkspaceRootDisplay &&
      normalizePathForComparison(workspaceRoot) === lastLoadedWorkspaceRoot
    ) {
      return lastLoadedWorkspaceRootDisplay;
    }
    return normalizeDisplayPath(workspaceRoot);
  };

  /**
   * The tree's spelling of a directory that some other layer (the OS watcher,
   * the cache bookkeeping) named with a folded key. Falls back to the caller's
   * own spelling, and finally to the key itself for a directory the tree has
   * never seen.
   */
  const treeDirectoryPath = (comparisonKey: string, fallback: string): string => {
    if (state.childrenByPath.has(fallback) || state.expandedPaths.has(fallback)) {
      return fallback;
    }
    for (const path of state.childrenByPath.keys()) {
      if (normalizePathForComparison(path) === comparisonKey) {
        return path;
      }
    }
    for (const path of state.expandedPaths) {
      if (normalizePathForComparison(path) === comparisonKey) {
        return path;
      }
    }
    for (const node of state.rootNodes) {
      if (node.kind === "directory" && normalizePathForComparison(node.path) === comparisonKey) {
        return node.path;
      }
    }
    for (const nodes of state.childrenByPath.values()) {
      for (const node of nodes) {
        if (node.kind === "directory" && normalizePathForComparison(node.path) === comparisonKey) {
          return node.path;
        }
      }
    }
    return fallback;
  };

  const reloadDirectories = async (
    workspaceRoot: string | null,
    directoryPaths: string[],
  ): Promise<void> => {
    if (!workspaceRoot || directoryPaths.length === 0) {
      return;
    }
    const rootPath = treeWorkspaceRoot(workspaceRoot);
    const normalizedRoot = normalizePathForComparison(rootPath);
    // De-duplicate on the comparison key, but remember a real spelling for each
    // directory: `childrenByPath` is keyed exactly as the tree rows are, so a
    // listing stored under a folded key is a listing no row will ever read.
    const spellingByKey = new Map<string, string>();
    for (const path of directoryPaths) {
      const key = normalizePathForComparison(path);
      if (!spellingByKey.has(key)) {
        spellingByKey.set(key, normalizeDisplayPath(path));
      }
    }
    const unique = [...spellingByKey.keys()];
    // Record these directories as freshly reloaded so the debounced
    // filesystem-change flush (which fires ~400ms later for the same paths via
    // both the in-app notify and the OS watcher) does not re-render them.
    markDirsFresh(unique);
    // This is an authoritative re-read: drop the shared cached listings first,
    // or the reload just re-reads the very listing the change invalidated and
    // concludes that nothing moved.
    invalidateDirectoryCache?.(unique);
    if (spellingByKey.has(normalizedRoot)) {
      // Capture the generation before the await so a workspace switch (or a
      // manual refresh) that lands while the root listing is in flight cannot
      // overwrite the now-active workspace's tree with this stale result. The
      // non-root branch gets the same protection from `loadProjectTreeChildren`.
      const loadGeneration = rootLoadGeneration;
      const showHiddenAtSchedule = state.showHidden;
      const rootNodes = await loadChildren(rootPath, rootPath, {
        showHidden: showHiddenAtSchedule,
      });
      if (
        loadGeneration !== rootLoadGeneration ||
        lastLoadedWorkspaceRoot !== normalizedRoot
      ) {
        return;
      }
      state = {
        ...state,
        rootNodes,
      };
      publish();
    }
    for (const [key, spelling] of spellingByKey) {
      if (key === normalizedRoot) {
        continue;
      }
      if (!isPathInsideRoot(key, normalizedRoot)) {
        continue;
      }
      await loadProjectTreeChildren(rootPath, treeDirectoryPath(key, spelling));
    }
  };

  const flushFilesystemChanges = async (workspaceRoot: string | null): Promise<void> => {
    if (!workspaceRoot || pendingFilesystemDirs.size === 0) {
      pendingFilesystemDirs.clear();
      return;
    }
    const dirs = filterFreshDirs([...pendingFilesystemDirs]);
    pendingFilesystemDirs.clear();
    if (dirs.length === 0) {
      return;
    }
    await reloadDirectories(workspaceRoot, dirs);
  };

  const handleFilesystemChange = (workspaceRoot: string | null, changedPath: string): void => {
    const normalizedChangedPath = normalizePathForComparison(changedPath);
    const preferredRoot = workspaceRoot ? normalizePathForComparison(workspaceRoot) : null;
    const candidateRoots = [
      ...(preferredRoot ? [preferredRoot] : []),
      ...cachedTrees.keys(),
      ...(lastLoadedWorkspaceRoot ? [lastLoadedWorkspaceRoot] : []),
    ];
    const targetRoot = candidateRoots
      .filter((root, index) => candidateRoots.indexOf(root) === index)
      .filter((root) => isPathInsideRoot(normalizedChangedPath, root))
      .sort((a, b) => b.length - a.length)[0];
    if (!targetRoot) {
      return;
    }
    if (targetRoot !== lastLoadedWorkspaceRoot) {
      const cached = cachedTrees.get(targetRoot);
      if (!cached) {
        return;
      }
      const staleDirectories = directoriesToRefreshForChange(
        targetRoot,
        changedPath,
        cached.state.expandedPaths,
      );
      staleDirectories.push(targetRoot);
      for (const directory of staleDirectories) {
        cached.staleDirectories.add(directory);
      }
      touchCachedTree(targetRoot, cached);
      return;
    }
    const dirs = directoriesToRefreshForChange(
      targetRoot,
      changedPath,
      state.expandedPaths,
    );
    const normalizedRoot = targetRoot;
    if (dirs.length === 0 && normalizePathForComparison(changedPath) !== normalizedRoot) {
      return;
    }
    for (const dir of dirs) {
      pendingFilesystemDirs.add(dir);
    }
    pendingFilesystemDirs.add(normalizedRoot);
    if (filesystemChangeTimer) {
      clearTimeout(filesystemChangeTimer);
    }
    filesystemChangeTimer = setTimeout(() => {
      filesystemChangeTimer = null;
      void flushFilesystemChanges(targetRoot);
    }, FILESYSTEM_CHANGE_DEBOUNCE_MS);
  };

  const clearFilesystemChangeDebounce = (): void => {
    if (filesystemChangeTimer) {
      clearTimeout(filesystemChangeTimer);
      filesystemChangeTimer = null;
    }
    pendingFilesystemDirs.clear();
  };

  publish();

  return {
    getState: () => cloneState(state),
    setShowHidden: (next: boolean) => {
      if (state.showHidden === next) {
        return;
      }
      // Cached snapshots hold listings loaded with their own showHidden value;
      // republishing them after a toggle would show a flag/listing mismatch
      // (toggle on but hidden files absent, or vice versa). Drop them so the
      // next entry to each workspace reloads under the new setting.
      cachedTrees.clear();
      state = {
        ...state,
        showHidden: next,
      };
      publish();
    },
    collapseAll: () => {
      state = { ...state, expandedPaths: new Set() };
      publish();
    },
    loadProjectTreeRoot,
    loadProjectTreeChildren,
    handleToggleProjectTreeDirectory,
    refreshProjectTree,
    revalidateProjectTree,
    ensureExpandedForActiveFile,
    restoreExpandedPaths,
    handleFilesystemChange,
    reloadDirectories,
    clearFilesystemChangeDebounce,
    getCachedRootCount: () => cachedTrees.size,
  };
}
