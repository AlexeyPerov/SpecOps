import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import type { DiskFingerprint } from "../domain/contracts";
import { SKIPPED_DIRECTORY_NAMES } from "./folderOpenableFiles";
import { normalizePathSync, statDiskFingerprint } from "./diskFingerprint";
import { applyReplaceAll } from "../editor/editorSearchOps";
import {
  closeTabsForDeletedDocumentsUnderPath,
  markDocumentsMissingUnderPath,
  syncDocumentsAfterPathRelocation,
} from "./relocateWorkspacePaths";
import { isPathUnderRoot } from "./workspacePaths";

export type ProjectFileOpResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/** Result of replacing all matches inside a single project file. */
export type ProjectReplaceResult =
  | { ok: true; path: string; count: number; content: string; fingerprint: DiskFingerprint }
  | { ok: false; reason: string; count: number };

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function parentDirectory(path: string): string {
  const normalized = normalizePathSync(path).replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return normalized;
  }
  return normalized.slice(0, slash);
}

export function validateEntryName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Name cannot be empty.";
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "Name cannot contain path separators.";
  }
  if (trimmed === "." || trimmed === "..") {
    return "Invalid name.";
  }
  return null;
}

export function isBlockedProjectTreeDirectory(dirPath: string): boolean {
  const normalized = normalizePathSync(dirPath).replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  for (const segment of segments) {
    if (segment.startsWith(".")) {
      return true;
    }
    if (SKIPPED_DIRECTORY_NAMES.has(segment.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function isDescendantOrEqual(ancestor: string, path: string): boolean {
  const normalizedAncestor = normalizePathSync(ancestor).replace(/\/+$/, "");
  const normalizedPath = normalizePathSync(path).replace(/\/+$/, "");
  return (
    normalizedPath === normalizedAncestor ||
    normalizedPath.startsWith(`${normalizedAncestor}/`)
  );
}

export function canMoveEntry(
  workspaceRoot: string,
  sourcePath: string,
  destDirPath: string,
): string | null {
  if (!isPathUnderRoot(sourcePath, workspaceRoot) || !isPathUnderRoot(destDirPath, workspaceRoot)) {
    return "Path is outside the workspace.";
  }
  const normalizedSource = normalizePathSync(sourcePath).replace(/\/+$/, "");
  const normalizedDestDir = normalizePathSync(destDirPath).replace(/\/+$/, "");
  if (normalizedSource === normalizedDestDir) {
    return "Cannot move an item into itself.";
  }
  if (isDescendantOrEqual(normalizedSource, normalizedDestDir)) {
    return "Cannot move a folder into itself or its subfolder.";
  }
  if (parentDirectory(normalizedSource) === normalizedDestDir) {
    return "Item is already in this folder.";
  }
  if (isBlockedProjectTreeDirectory(normalizedDestDir)) {
    return "Cannot move into this folder.";
  }
  return null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    return await exists(path);
  } catch {
    return false;
  }
}

export async function createProjectFile(
  workspaceRoot: string,
  parentDirPath: string,
  name: string,
): Promise<ProjectFileOpResult> {
  const nameError = validateEntryName(name);
  if (nameError) {
    return { ok: false, reason: nameError };
  }
  if (!isPathUnderRoot(parentDirPath, workspaceRoot)) {
    return { ok: false, reason: "Parent folder is outside the workspace." };
  }
  if (isBlockedProjectTreeDirectory(parentDirPath)) {
    return { ok: false, reason: "Cannot create files in this folder." };
  }
  const targetPath = await join(parentDirPath, name.trim());
  if (await pathExists(targetPath)) {
    return { ok: false, reason: "A file or folder with that name already exists." };
  }
  try {
    await writeTextFile(targetPath, "");
    return { ok: true, path: targetPath };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

/**
 * Replace every occurrence of `query` with `replacement` inside an existing
 * workspace file and persist the result. The new content is returned so callers
 * can sync any open document for that path. Files outside the workspace or
 * skipped (heavy/hidden) directories are rejected without touching disk.
 */
export async function replaceInProjectFile(
  workspaceRoot: string,
  filePath: string,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): Promise<ProjectReplaceResult> {
  if (!query) {
    return { ok: false, reason: "Query is empty.", count: 0 };
  }
  if (!isPathUnderRoot(filePath, workspaceRoot)) {
    return { ok: false, reason: "File is outside the workspace.", count: 0 };
  }
  if (isBlockedProjectTreeDirectory(filePath)) {
    return { ok: false, reason: "Cannot modify files in this folder.", count: 0 };
  }
  let content: string;
  try {
    content = await readTextFile(filePath);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason, count: 0 };
  }
  const { text: nextContent, count } = applyReplaceAll(
    content,
    query,
    replacement,
    caseSensitive,
  );
  if (count === 0) {
    return { ok: false, reason: "No matches.", count: 0 };
  }
  try {
    await writeTextFile(filePath, nextContent);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason, count: 0 };
  }
  // Capture the post-write fingerprint so callers can refresh the disk state
  // of any open document for this path (suppressing a watcher self-echo and
  // keeping the buffer in sync without flipping it dirty).
  let fingerprint: DiskFingerprint;
  try {
    fingerprint = await statDiskFingerprint(filePath);
  } catch {
    fingerprint = { mtimeMs: 0, sizeBytes: nextContent.length };
  }
  return { ok: true, path: filePath, count, content: nextContent, fingerprint };
}

export async function createProjectFolder(
  workspaceRoot: string,
  parentDirPath: string,
  name: string,
): Promise<ProjectFileOpResult> {
  const nameError = validateEntryName(name);
  if (nameError) {
    return { ok: false, reason: nameError };
  }
  if (!isPathUnderRoot(parentDirPath, workspaceRoot)) {
    return { ok: false, reason: "Parent folder is outside the workspace." };
  }
  if (isBlockedProjectTreeDirectory(parentDirPath)) {
    return { ok: false, reason: "Cannot create folders in this folder." };
  }
  const targetPath = await join(parentDirPath, name.trim());
  if (await pathExists(targetPath)) {
    return { ok: false, reason: "A file or folder with that name already exists." };
  }
  try {
    await mkdir(targetPath);
    return { ok: true, path: targetPath };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

export async function renameProjectEntry(
  workspaceRoot: string,
  entryPath: string,
  newName: string,
  windowId: string,
): Promise<ProjectFileOpResult> {
  const nameError = validateEntryName(newName);
  if (nameError) {
    return { ok: false, reason: nameError };
  }
  if (!isPathUnderRoot(entryPath, workspaceRoot)) {
    return { ok: false, reason: "Path is outside the workspace." };
  }
  const parent = parentDirectory(entryPath);
  const targetPath = await join(parent, newName.trim());
  if (normalizePathSync(targetPath) === normalizePathSync(entryPath)) {
    return { ok: false, reason: "Name unchanged." };
  }
  if (await pathExists(targetPath)) {
    return { ok: false, reason: "A file or folder with that name already exists." };
  }
  try {
    await rename(entryPath, targetPath);
    await syncDocumentsAfterPathRelocation(workspaceRoot, entryPath, targetPath, windowId);
    return { ok: true, path: targetPath };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

export async function deleteProjectEntry(
  workspaceRoot: string,
  entryPath: string,
): Promise<ProjectFileOpResult> {
  if (!isPathUnderRoot(entryPath, workspaceRoot)) {
    return { ok: false, reason: "Path is outside the workspace." };
  }
  const normalizedRoot = normalizePathSync(workspaceRoot).replace(/\/+$/, "");
  const normalizedEntry = normalizePathSync(entryPath).replace(/\/+$/, "");
  if (normalizedEntry === normalizedRoot) {
    return { ok: false, reason: "Cannot delete the workspace root." };
  }
  try {
    await remove(entryPath, { recursive: true });
    markDocumentsMissingUnderPath(workspaceRoot, entryPath);
    closeTabsForDeletedDocumentsUnderPath(workspaceRoot, entryPath);
    return { ok: true, path: entryPath };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

export async function moveProjectEntry(
  workspaceRoot: string,
  sourcePath: string,
  destDirPath: string,
  windowId: string,
): Promise<ProjectFileOpResult> {
  const moveError = canMoveEntry(workspaceRoot, sourcePath, destDirPath);
  if (moveError) {
    return { ok: false, reason: moveError };
  }
  const targetPath = await join(destDirPath, basename(sourcePath));
  if (await pathExists(targetPath)) {
    return { ok: false, reason: "Destination already has an item with this name." };
  }
  try {
    await rename(sourcePath, targetPath);
    await syncDocumentsAfterPathRelocation(workspaceRoot, sourcePath, targetPath, windowId);
    return { ok: true, path: targetPath };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

export function parentDirForRefresh(entryPath: string): string {
  return parentDirectory(entryPath);
}
