import { normalizePathSync } from "./diskFingerprint";
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

function normalizePathForComparison(path: string): string {
  return normalizePathSync(path).replace(/\/+$/, "");
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
  const relative = normalizedPath.slice(normalizedRoot.length + 1);
  const parts = relative.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return [];
  }
  const paths: string[] = [];
  let cursor = normalizedRoot;
  for (const part of parts.slice(0, -1)) {
    cursor = `${cursor}/${part}`;
    paths.push(cursor);
  }
  return paths;
}

const FILESYSTEM_CHANGE_DEBOUNCE_MS = 400;

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
 */
export function directoriesToRefreshForChange(
  workspaceRoot: string,
  changedPath: string,
  expandedPaths: Set<string>,
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
  const parent = parentDirectoryPath(normalizedChanged);
  if (parent === normalizedRoot || expandedPaths.has(parent)) {
    dirs.add(parent);
  }
  if (expandedPaths.has(normalizedChanged)) {
    dirs.add(normalizedChanged);
  }
  if (normalizedChanged !== normalizedRoot && parent !== normalizedRoot) {
    const grandparent = parentDirectoryPath(parent);
    if (grandparent === normalizedRoot || expandedPaths.has(grandparent)) {
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
  setShowHidden: (next: boolean) => void;
  loadProjectTreeRoot: (options: LoadProjectTreeRootOptions) => Promise<void>;
  loadProjectTreeChildren: (workspaceRoot: string | null, directoryPath: string) => Promise<void>;
  handleToggleProjectTreeDirectory: (workspaceRoot: string | null, path: string) => Promise<void>;
  refreshProjectTree: (workspaceRoot: string | null, isSessionTabActive: boolean) => Promise<void>;
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
  let state = createInitialState();
  let lastLoadedWorkspaceRoot: string | null = null;
  /** Bumped on every root load/reset so slower in-flight loads cannot overwrite a newer workspace. */
  let rootLoadGeneration = 0;
  let filesystemChangeTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingFilesystemDirs = new Set<string>();
  const maxCachedRoots = Math.max(1, deps.maxCachedRoots ?? 6);
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
    lastExpandedSignature = null;
    suppressNextExpandedPathsPublish = false;
    publish();
  };

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

  const reloadDirectories = async (
    workspaceRoot: string | null,
    directoryPaths: string[],
  ): Promise<void> => {
    if (!workspaceRoot || directoryPaths.length === 0) {
      return;
    }
    const normalizedRoot = normalizePathForComparison(workspaceRoot);
    const unique = [...new Set(directoryPaths.map((path) => normalizePathForComparison(path)))];
    if (unique.includes(normalizedRoot)) {
      // Capture the generation before the await so a workspace switch (or a
      // manual refresh) that lands while the root listing is in flight cannot
      // overwrite the now-active workspace's tree with this stale result. The
      // non-root branch gets the same protection from `loadProjectTreeChildren`.
      const loadGeneration = rootLoadGeneration;
      const showHiddenAtSchedule = state.showHidden;
      const rootNodes = await loadChildren(workspaceRoot, workspaceRoot, {
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
    for (const directoryPath of unique) {
      if (directoryPath === normalizedRoot) {
        continue;
      }
      if (!isPathInsideRoot(directoryPath, workspaceRoot)) {
        continue;
      }
      await loadProjectTreeChildren(workspaceRoot, directoryPath);
    }
  };

  const flushFilesystemChanges = async (workspaceRoot: string | null): Promise<void> => {
    if (!workspaceRoot || pendingFilesystemDirs.size === 0) {
      pendingFilesystemDirs.clear();
      return;
    }
    const dirs = [...pendingFilesystemDirs];
    pendingFilesystemDirs.clear();
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
    loadProjectTreeRoot,
    loadProjectTreeChildren,
    handleToggleProjectTreeDirectory,
    refreshProjectTree,
    ensureExpandedForActiveFile,
    restoreExpandedPaths,
    handleFilesystemChange,
    reloadDirectories,
    clearFilesystemChangeDebounce,
    getCachedRootCount: () => cachedTrees.size,
  };
}
