import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readFile, remove, rename } from "@tauri-apps/plugin-fs";
import { atomicWriteTextFile } from "./atomicWrite";
import type { DiskFingerprint } from "../domain/contracts";
import { SKIPPED_DIRECTORY_NAMES } from "./folderOpenableFiles";
import {
  beginSaveInFlight,
  clearSaveInFlight,
  recordWriteFingerprint,
} from "./externalFileChanges";
import {
  fingerprintFromWrittenBytes,
  normalizePathForStorage,
  normalizePathSync,
  pathsEqual,
  statDiskFingerprint,
} from "./diskFingerprint";
import { replaceAllInString, validateSearchQuery, type SearchQuery } from "../editor/searchQuery";
import {
  closeTabsForDeletedDocumentsUnderPath,
  markDocumentsMissingUnderPath,
  syncDocumentsAfterPathRelocation,
} from "./relocateWorkspacePaths";
import { isPathUnderRoot } from "./workspacePaths";
import { decodeTextFile, encodeTextFile, type DocumentLineEnding } from "./textEncoding";

export type ProjectFileOpResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/** Result of replacing all matches inside a single project file. */
export type ProjectReplaceResult =
  | {
      ok: true;
      path: string;
      count: number;
      /** LF-normalized content (matches what the editor store holds). */
      content: string;
      fingerprint: DiskFingerprint;
      /** On-disk line ending, preserved across the replace. */
      lineEnding: DocumentLineEnding;
      /** Whether the file began with a UTF-8 BOM, preserved across the replace. */
      hasBom: boolean;
    }
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
    await atomicWriteTextFile(targetPath, "");
    return { ok: true, path: targetPath };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

/**
 * Replace every occurrence of the query with the query's replacement inside an
 * existing workspace file and persist the result. The new content is returned
 * so callers can sync any open document for that path. Files outside the
 * workspace or skipped (heavy/hidden) directories are rejected without touching
 * disk. Uses the unified query model so regex/capture/whole-word replacement
 * agrees with in-file search.
 */
export async function replaceInProjectFile(
  workspaceRoot: string,
  filePath: string,
  query: SearchQuery,
): Promise<ProjectReplaceResult> {
  const validation = validateSearchQuery(query);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason, count: 0 };
  }
  if (!isPathUnderRoot(filePath, workspaceRoot)) {
    return { ok: false, reason: "File is outside the workspace.", count: 0 };
  }
  if (isBlockedProjectTreeDirectory(filePath)) {
    return { ok: false, reason: "Cannot modify files in this folder.", count: 0 };
  }
  // Read raw bytes and strict-decode, mirroring the open-file path (C5). A
  // lossy `readTextFile` here would rewrite a Latin-1 / UTF-16 / small-binary
  // file that happens to match the query with U+FFFD, destroying it on save.
  // Skip non-UTF-8 files with a surfaced reason instead of corrupting them.
  let bytes: Uint8Array;
  try {
    bytes = await readFile(filePath);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason, count: 0 };
  }
  const decoded = decodeTextFile(bytes);
  if (!decoded) {
    return {
      ok: false,
      reason: "File is not valid UTF-8 text and was skipped.",
      count: 0,
    };
  }
  const { text: nextContent, count } = replaceAllInString(decoded.content, query);
  if (count === 0) {
    return { ok: false, reason: "No matches.", count: 0 };
  }
  // Re-apply the original line ending and BOM so a CRLF / BOM'd file is not
  // silently rewritten as LF with no BOM. The editor store always holds the
  // LF-normalized form, so `nextContent` (already LF) is what we return.
  const encoded = encodeTextFile(nextContent, {
    lineEnding: decoded.lineEnding,
    hasBom: decoded.hasBom,
  });
  const writtenBytes = new TextEncoder().encode(encoded);
  // Register this as an app-initiated write so a watcher self-echo landing
  // before the fingerprint is recorded does not trigger a reload/dirty prompt.
  beginSaveInFlight(filePath);
  try {
    await atomicWriteTextFile(filePath, encoded);
  } catch (error: unknown) {
    clearSaveInFlight(filePath);
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason, count: 0 };
  }
  // Capture the post-write fingerprint so callers can refresh the disk state
  // of any open document for this path. `fingerprintFromWrittenBytes` carries a
  // content hash tied to the exact bytes we wrote (so even a same-size edit is
  // recognised), and `recordWriteFingerprint` arms the self-write guard for any
  // watcher event that arrives after this point.
  let fingerprint: DiskFingerprint;
  try {
    fingerprint = await fingerprintFromWrittenBytes(filePath, writtenBytes);
    recordWriteFingerprint(filePath, fingerprint);
  } catch {
    // Fallback only when the post-write stat itself fails: use the byte length
    // (not the string length, which is wrong for non-ASCII — string length
    // counts UTF-16 code units, not bytes).
    fingerprint = { mtimeMs: 0, sizeBytes: writtenBytes.length };
  } finally {
    clearSaveInFlight(filePath);
  }
  return {
    ok: true,
    path: filePath,
    count,
    content: nextContent,
    fingerprint,
    lineEnding: decoded.lineEnding,
    hasBom: decoded.hasBom,
  };
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
  // Exact (case-preserving) equality only — case-only renames are allowed on
  // case-insensitive filesystems and must not be rejected as "unchanged".
  if (normalizePathForStorage(targetPath) === normalizePathForStorage(entryPath)) {
    return { ok: false, reason: "Name unchanged." };
  }
  if ((await pathExists(targetPath)) && !pathsEqual(targetPath, entryPath)) {
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
