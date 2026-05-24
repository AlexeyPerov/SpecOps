import { join } from "@tauri-apps/api/path";
import { readDir, type DirEntry } from "@tauri-apps/plugin-fs";
import { isOpenableFilePath } from "../editor/editorLanguage";

export const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  ".venv",
  "__pycache__",
]);

export type FolderListEntry = Pick<DirEntry, "name" | "isDirectory" | "isFile"> & {
  isHidden?: boolean;
};

function entryIsHidden(entry: FolderListEntry): boolean {
  return entry.isHidden === true;
}

export function shouldSkipDirectoryEntry(entry: FolderListEntry): boolean {
  if (!entry.isDirectory) {
    return false;
  }
  const name = entry.name;
  if (name.startsWith(".")) {
    return true;
  }
  if (entryIsHidden(entry)) {
    return true;
  }
  return SKIPPED_DIRECTORY_NAMES.has(name.toLowerCase());
}

export function shouldSkipFileEntry(entry: FolderListEntry): boolean {
  if (entry.isDirectory) {
    return false;
  }
  const name = entry.name;
  if (name.startsWith(".")) {
    return true;
  }
  if (entryIsHidden(entry)) {
    return true;
  }
  return false;
}

export function joinDirectoryPath(directoryPath: string, name: string): string {
  const base = directoryPath.replace(/[\\/]+$/, "");
  return `${base}/${name}`;
}

export function collectOpenablePathsFromEntries(
  entries: FolderListEntry[],
  directoryPath: string,
): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }
    if (shouldSkipFileEntry(entry)) {
      continue;
    }
    const path = joinDirectoryPath(directoryPath, entry.name);
    if (isOpenableFilePath(path)) {
      paths.push(path);
    }
  }
  return paths.sort((a, b) => a.localeCompare(b));
}

async function walkDirectory(directoryPath: string, paths: string[]): Promise<void> {
  let entries: DirEntry[];
  try {
    entries = await readDir(directoryPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    const folderEntry = entry as FolderListEntry;
    if (folderEntry.isDirectory) {
      if (shouldSkipDirectoryEntry(folderEntry)) {
        continue;
      }
      await walkDirectory(await join(directoryPath, entry.name), paths);
      continue;
    }
    if (shouldSkipFileEntry(folderEntry)) {
      continue;
    }
    const path = await join(directoryPath, entry.name);
    if (isOpenableFilePath(path)) {
      paths.push(path);
    }
  }
}

export async function collectOpenableFolderFiles(rootPath: string): Promise<string[]> {
  const paths: string[] = [];
  await walkDirectory(rootPath.replace(/[\\/]+$/, ""), paths);
  return paths.sort((a, b) => a.localeCompare(b));
}
