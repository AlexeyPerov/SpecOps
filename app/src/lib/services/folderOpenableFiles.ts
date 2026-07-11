/**
 * Openable-folder helpers. Traversal policy lives in `workspaceTraversal.ts`;
 * this module keeps the historical API for open-all-in-folder and tests.
 */

import { isOpenableFilePath } from "../editor/editorLanguage";
import {
  enumerateOpenableWorkspaceFiles,
  joinDirectoryPath,
  shouldSkipDirectoryEntry,
  shouldSkipFileEntry,
  SKIPPED_DIRECTORY_NAMES,
  type WorkspaceListEntry,
} from "./workspaceTraversal";

export { SKIPPED_DIRECTORY_NAMES, shouldSkipDirectoryEntry, shouldSkipFileEntry, joinDirectoryPath };

export type FolderListEntry = WorkspaceListEntry;

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

/** One-shot recursive walk; prefer the workspace file catalog when available. */
export async function collectOpenableFolderFiles(rootPath: string): Promise<string[]> {
  const result = await enumerateOpenableWorkspaceFiles(rootPath);
  return result.cancelled ? [] : result.paths;
}
