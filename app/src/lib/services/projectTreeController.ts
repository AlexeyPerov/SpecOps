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
}

export interface LoadProjectTreeRootOptions {
  workspaceRoot: string | null;
  isSessionTabActive: boolean;
  onWorkspaceBlocked?: () => void;
  force?: boolean;
}

function createInitialState(showHidden = false): ProjectTreeControllerState {
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
  handleFilesystemChange: (workspaceRoot: string | null, changedPath: string) => void;
  reloadDirectories: (workspaceRoot: string | null, directoryPaths: string[]) => Promise<void>;
  clearFilesystemChangeDebounce: () => void;
} {
  const loadChildren = deps.loadDirectoryChildrenFn ?? loadDirectoryChildren;
  const probeAccess = deps.probeWorkspaceReadAccessFn;
  let state = createInitialState();
  let lastLoadedWorkspaceRoot: string | null = null;
  let filesystemChangeTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingFilesystemDirs = new Set<string>();

  const publish = (): void => {
    onStateChange(cloneState(state));
  };

  const reset = (): void => {
    state = createInitialState(state.showHidden);
    lastLoadedWorkspaceRoot = null;
    publish();
  };

  const loadProjectTreeChildren = async (
    workspaceRoot: string | null,
    directoryPath: string,
  ): Promise<void> => {
    if (!workspaceRoot || !isPathInsideRoot(directoryPath, workspaceRoot)) {
      return;
    }
    state = {
      ...state,
      loadingPaths: new Set([...state.loadingPaths, directoryPath]),
    };
    publish();
    try {
      const children = await loadChildren(workspaceRoot, directoryPath, {
        showHidden: state.showHidden,
      });
      const nextChildren = new Map(state.childrenByPath);
      nextChildren.set(directoryPath, children);
      state = {
        ...state,
        childrenByPath: nextChildren,
      };
      publish();
    } finally {
      const nextLoading = new Set(state.loadingPaths);
      nextLoading.delete(directoryPath);
      state = {
        ...state,
        loadingPaths: nextLoading,
      };
      publish();
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

    const rootNodes = await loadChildren(workspaceRoot, workspaceRoot, {
      showHidden: state.showHidden,
    });
    state = {
      ...state,
      rootNodes,
    };
    lastLoadedWorkspaceRoot = normalizedWorkspaceRoot;
    publish();

    if (isSessionTabActive && probeAccess) {
      const probe = await probeAccess(workspaceRoot);
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
    state = {
      ...state,
      expandedPaths: new Set([...state.expandedPaths, path]),
    };
    publish();
    if (!state.childrenByPath.has(path)) {
      await loadProjectTreeChildren(workspaceRoot, path);
    }
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
      publish();
    }

    for (const ancestorPath of ancestorsToLoad) {
      await loadProjectTreeChildren(workspaceRoot, ancestorPath);
    }
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
      const rootNodes = await loadChildren(workspaceRoot, workspaceRoot, {
        showHidden: state.showHidden,
      });
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
    if (!workspaceRoot) {
      return;
    }
    const dirs = directoriesToRefreshForChange(
      workspaceRoot,
      changedPath,
      state.expandedPaths,
    );
    const normalizedRoot = normalizePathForComparison(workspaceRoot);
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
      void flushFilesystemChanges(workspaceRoot);
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
    handleFilesystemChange,
    reloadDirectories,
    clearFilesystemChangeDebounce,
  };
}
