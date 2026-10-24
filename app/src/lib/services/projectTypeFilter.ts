import { normalizePathSync } from "./diskFingerprint";
import { enumerateWorkspaceFiles, type WorkspaceListEntry } from "./workspaceTraversal";
import { isImageFilePath } from "./fileContentKind";
import type { ProjectTreeNode } from "./projectTree";

export type ProjectFileFilter = "all" | "markdown" | "images";
export const PROJECT_FILE_FILTERS: { value: ProjectFileFilter; label: string }[] = [
  { value: "all", label: "All files" },
  { value: "markdown", label: "Markdown" },
  { value: "images", label: "Images and textures" },
];
const TEXTURE_EXTENSIONS = new Set(["tga", "dds", "ktx", "ktx2", "hdr", "exr", "tif", "tiff", "psd", "psb"]);
export function matchesProjectFileFilter(path: string, filter: ProjectFileFilter): boolean {
  if (filter === "all") return true;
  if (filter === "markdown") return path.toLowerCase().endsWith(".md");
  return isImageFilePath(path) || TEXTURE_EXTENSIONS.has(path.split(".").pop()!.toLowerCase());
}
export interface ProjectFilterSnapshot {
  directories: ReadonlySet<string> | null;
  unknownDirectories: readonly string[];
  loading: boolean;
  incomplete: boolean;
}
export function filterProjectNodes(nodes: readonly ProjectTreeNode[], filter: ProjectFileFilter, snapshot: ProjectFilterSnapshot): ProjectTreeNode[] {
  if (filter === "all") return [...nodes];
  return nodes.filter((node) => {
    if (node.kind === "file") return matchesProjectFileFilter(node.path, filter);
    const key = normalizePathSync(node.path);
    return snapshot.directories === null || snapshot.directories.has(key)
      || snapshot.unknownDirectories.some((path) => path === key || path.startsWith(`${key}/`) || key.startsWith(`${path}/`));
  });
}

/** One lazy index for the selected type. Directory listings are shared with the tree. */
export function createProjectTypeFilter(deps: {
  readDir?: (path: string) => Promise<WorkspaceListEntry[]>;
  publish: (snapshot: ProjectFilterSnapshot) => void;
}) {
  let root = "";
  let filter: ProjectFileFilter = "all";
  let hidden = false;
  let enabled = false;
  let disposed = false;
  let generation = 0;
  let running = false;
  let dirty = false;
  let invalidated = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let snapshot: ProjectFilterSnapshot = { directories: null, unknownDirectories: [], loading: false, incomplete: false };
  function publish(next: ProjectFilterSnapshot) { snapshot = next; deps.publish(next); }
  async function run() {
    if (!enabled || filter === "all" || disposed || !root) return;
    if (running) { dirty = true; return; }
    running = true;
    dirty = false;
    invalidated = false;
    const gen = generation;
    const selectedFilter = filter;
    const selectedRoot = root;
    publish({ ...snapshot, loading: true });
    try {
      const result = await enumerateWorkspaceFiles(selectedRoot, {
        readDir: deps.readDir, showHidden: hidden,
        acceptsPath: (path) => matchesProjectFileFilter(path, selectedFilter),
        isCancelled: () => disposed || gen !== generation || !enabled,
      });
      if (disposed || gen !== generation || !enabled || result.cancelled) return;
      const dirs = new Set<string>();
      const rootKey = normalizePathSync(selectedRoot).replace(/\/+$/, "");
      for (const path of result.paths) {
        let cursor = normalizePathSync(path).replace(/\/[^/]+$/, "");
        while (cursor.length > rootKey.length && !dirs.has(cursor)) {
          dirs.add(cursor);
          const parent = cursor.replace(/\/[^/]+$/, "");
          if (parent === cursor) break;
          cursor = parent;
        }
      }
      publish({ directories: result.truncated || invalidated ? null : dirs,
        unknownDirectories: result.partialErrors.map(normalizePathSync), loading: false,
        incomplete: !!result.truncated || result.partialErrors.length > 0 });
    } catch {
      if (!disposed && gen === generation && enabled) publish({ directories: null, unknownDirectories: [], loading: false, incomplete: true });
    } finally {
      running = false;
      if (dirty && !disposed) { dirty = false; void run(); }
    }
  }
  return {
    configure(nextRoot: string, nextFilter: ProjectFileFilter, showHidden: boolean, active: boolean) {
      const changed = root !== nextRoot || filter !== nextFilter || hidden !== showHidden;
      const resumed = !enabled && active;
      if (!changed && enabled === active) return;
      root = nextRoot; filter = nextFilter; hidden = showHidden; enabled = active;
      generation += 1;
      clearTimeout(timer);
      if (changed) publish({ directories: null, unknownDirectories: [], loading: false, incomplete: false });
      if (enabled && (changed || resumed)) void run();
    },
    changed(path: string, kind: string) {
      const key = normalizePathSync(path);
      const rootKey = normalizePathSync(root).replace(/\/+$/, "");
      if (!enabled || filter === "all" || kind === "modify" || (key !== rootKey && !key.startsWith(`${rootKey}/`))) return;
      invalidated = true;
      // Existing results cannot prove absence while directory structure is changing.
      publish({ ...snapshot, directories: null });
      clearTimeout(timer);
      timer = setTimeout(() => { void run(); }, 400);
    },
    refresh() { generation += 1; publish({ directories: null, unknownDirectories: [], loading: false, incomplete: false }); void run(); },
    dispose() { disposed = true; generation += 1; clearTimeout(timer); },
  };
}
