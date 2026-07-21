import { normalizePathSync } from "./diskFingerprint";
import {
  shouldSkipDirectoryEntry,
  shouldSkipFileEntry,
  shouldSkipHeavyDirectoryName,
  type WorkspaceListEntry,
} from "./workspaceTraversal";
import { readDir } from "@tauri-apps/plugin-fs";

export interface ProjectTreeNode {
  name: string;
  path: string;
  kind: "directory" | "file";
}

export interface LoadDirectoryChildrenOptions {
  showHidden: boolean;
  /** Injectable directory listing (e.g. shared workspace directory cache). */
  readDir?: (path: string) => Promise<WorkspaceListEntry[]>;
}

function isPathUnderRoot(path: string, workspaceRoot: string): boolean {
  const normalizedPath = normalizePathSync(path).replace(/\/+$/, "");
  const normalizedRoot = normalizePathSync(workspaceRoot).replace(/\/+$/, "");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function shouldKeepDirectoryEntry(entry: WorkspaceListEntry, showHidden: boolean): boolean {
  if (!entry.isDirectory) {
    return false;
  }
  if (!showHidden) {
    return !shouldSkipDirectoryEntry(entry);
  }
  return !entry.isHidden && !shouldSkipHeavyDirectoryName(entry.name);
}

function shouldKeepFileEntry(entry: WorkspaceListEntry, showHidden: boolean): boolean {
  if (entry.isDirectory) {
    return false;
  }
  if (showHidden) {
    return !entry.isHidden;
  }
  return !shouldSkipFileEntry(entry);
}

function sortNodes(nodes: ProjectTreeNode[]): ProjectTreeNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export async function loadDirectoryChildren(
  workspaceRoot: string,
  dirPath: string,
  options: LoadDirectoryChildrenOptions,
): Promise<ProjectTreeNode[]> {
  if (!isPathUnderRoot(dirPath, workspaceRoot)) {
    return [];
  }
  const readDirFn =
    options.readDir ??
    (async (path: string) => {
      const dirEntries = await readDir(path);
      return dirEntries as WorkspaceListEntry[];
    });

  let entries: WorkspaceListEntry[] = [];
  try {
    entries = await readDirFn(dirPath);
  } catch {
    return [];
  }

  const base = dirPath.replace(/[\\/]+$/, "");
  const nodes: ProjectTreeNode[] = [];
  for (const rawEntry of entries) {
    const entry = rawEntry as WorkspaceListEntry;
    if (entry.isSymlink) {
      continue;
    }
    const path = `${base}/${entry.name}`;
    if (!isPathUnderRoot(path, workspaceRoot)) {
      continue;
    }
    if (shouldKeepDirectoryEntry(entry, options.showHidden)) {
      nodes.push({ name: entry.name, path, kind: "directory" });
      continue;
    }
    if (shouldKeepFileEntry(entry, options.showHidden)) {
      nodes.push({ name: entry.name, path, kind: "file" });
    }
  }
  return sortNodes(nodes);
}
