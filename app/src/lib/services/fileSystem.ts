import { open, save } from "@tauri-apps/plugin-dialog";
import { readDir, readFile, readTextFile, rename, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import type { FileContentKind } from "./fileContentKind";
import { inferFileContentKind } from "./fileContentKind";
import { join } from "@tauri-apps/api/path";
import type { DiskFingerprint } from "../domain/contracts";
import type { WorkspaceAccessStatus } from "../ai/capabilities";
import { statDiskFingerprint } from "./diskFingerprint";
import { beginSaveInFlight, clearSaveInFlight, recordWriteFingerprint } from "./externalFileChanges";
import { appState } from "../state/appState";
import { normalizePathSync } from "./diskFingerprint";
import { ensureSpecOpsDataDir } from "./appDataDir";
import { logDiagnostic } from "./logging";
import {
  DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES,
  resolveBinaryFileOpen,
} from "./binaryFileOpen";

export interface OpenedFile {
  path: string;
  content: string;
  sizeBytes: number;
  contentKind: FileContentKind;
}

export interface FileSavePayload {
  path: string;
  content: string;
}

interface WorkspaceAccessSnapshot {
  version: 1;
  updatedAt: string;
  allowedWorkspaceRoots: string[];
}

const WORKSPACE_ACCESS_FILE = "workspace-access.json";

async function getWorkspaceAccessFilePath(): Promise<string> {
  const dataDir = await ensureSpecOpsDataDir();
  return join(dataDir, WORKSPACE_ACCESS_FILE);
}

async function readWorkspaceAccessSnapshot(): Promise<WorkspaceAccessSnapshot | null> {
  try {
    const path = await getWorkspaceAccessFilePath();
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      updatedAt?: unknown;
      allowedWorkspaceRoots?: unknown;
    };
    if (
      parsed.version !== 1 ||
      typeof parsed.updatedAt !== "string" ||
      !Array.isArray(parsed.allowedWorkspaceRoots)
    ) {
      return null;
    }
    const allowedWorkspaceRoots = parsed.allowedWorkspaceRoots.filter(
      (entry): entry is string => typeof entry === "string",
    );
    return {
      version: 1,
      updatedAt: parsed.updatedAt,
      allowedWorkspaceRoots,
    };
  } catch {
    return null;
  }
}

async function writeWorkspaceAccessSnapshot(snapshot: WorkspaceAccessSnapshot): Promise<void> {
  const path = await getWorkspaceAccessFilePath();
  await writeTextFile(path, JSON.stringify(snapshot, null, 2));
}

async function rememberWorkspaceReadAccess(normalizedRootPath: string): Promise<void> {
  const snapshot = (await readWorkspaceAccessSnapshot()) ?? {
    version: 1 as const,
    updatedAt: new Date().toISOString(),
    allowedWorkspaceRoots: [],
  };
  if (snapshot.allowedWorkspaceRoots.includes(normalizedRootPath)) {
    return;
  }
  snapshot.allowedWorkspaceRoots = [...snapshot.allowedWorkspaceRoots, normalizedRootPath];
  snapshot.updatedAt = new Date().toISOString();
  await writeWorkspaceAccessSnapshot(snapshot);
}

export async function readAllowedWorkspaceRoots(): Promise<string[]> {
  const snapshot = await readWorkspaceAccessSnapshot();
  if (!snapshot) {
    return [];
  }
  return snapshot.allowedWorkspaceRoots.map((path) => normalizePathSync(path));
}

/** Lightweight read probe without persisting allowed roots (for polling / FS hooks). */
export async function probeWorkspaceReadAccess(rootPath: string): Promise<WorkspaceAccessStatus> {
  const normalizedRootPath = normalizePathSync(rootPath);
  try {
    await readDir(normalizedRootPath);
    return "ready";
  } catch {
    return "blocked";
  }
}

export async function ensureWorkspaceReadAccess(rootPath: string): Promise<WorkspaceAccessStatus> {
  const normalizedRootPath = normalizePathSync(rootPath);
  try {
    await readDir(normalizedRootPath);
    await rememberWorkspaceReadAccess(normalizedRootPath);
    return "ready";
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await logDiagnostic({
      level: "warn",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "workspace read access preparation failed",
      metadata: {
        rootPath: normalizedRootPath,
        reason: message,
      },
    });
    return "blocked";
  }
}

export async function openFileDialog(): Promise<OpenedFile | null> {
  const workspaceRoot = appState.getWorkspaceRoot();
  const selectedPath = await open({
    title: "Open File",
    multiple: false,
    directory: false,
    defaultPath: workspaceRoot ?? undefined,
  });
  if (!selectedPath || Array.isArray(selectedPath)) {
    return null;
  }
  return openPath(selectedPath);
}

export async function openFolderDialog(defaultPath?: string | null): Promise<string | null> {
  const selectedPath = await open({
    title: "Open Folder",
    multiple: false,
    directory: true,
    defaultPath: defaultPath ?? undefined,
  });
  if (!selectedPath || Array.isArray(selectedPath)) {
    return null;
  }
  return selectedPath;
}

export async function saveFile(payload: FileSavePayload): Promise<DiskFingerprint> {
  // Mark the save as in-flight around the write so a watcher event landing
  // between the disk write and the fingerprint record is recognized as the
  // app's own write (self-echo) and does not trigger a reload or prompt.
  beginSaveInFlight(payload.path);
  try {
    await writeTextFile(payload.path, payload.content);
    const fingerprint = await statDiskFingerprint(payload.path);
    recordWriteFingerprint(payload.path, fingerprint);
    return fingerprint;
  } finally {
    clearSaveInFlight(payload.path);
  }
}

export async function saveFileAs(
  content: string,
  defaultPath?: string | null,
): Promise<{ path: string; fingerprint: DiskFingerprint } | null> {
  const selectedPath = await save({
    title: "Save File As",
    defaultPath: defaultPath ?? undefined,
  });
  if (!selectedPath) {
    return null;
  }
  beginSaveInFlight(selectedPath);
  try {
    await writeTextFile(selectedPath, content);
    const fingerprint = await statDiskFingerprint(selectedPath);
    recordWriteFingerprint(selectedPath, fingerprint);
    return { path: selectedPath, fingerprint };
  } finally {
    clearSaveInFlight(selectedPath);
  }
}

export async function renameFile(oldPath: string): Promise<string | null> {
  const selectedPath = await save({
    title: "Rename File",
    defaultPath: oldPath,
  });
  if (!selectedPath || selectedPath === oldPath) {
    return null;
  }
  await rename(oldPath, selectedPath);
  return selectedPath;
}

export interface OpenPathOptions {
  maxBinaryOpenAsTextBytes?: number;
}

export async function openPath(path: string, options?: OpenPathOptions): Promise<OpenedFile> {
  const fileStat = await stat(path);
  const sizeBytes = Number(fileStat.size);
  const bytes = await readFile(path);
  const contentKind = inferFileContentKind(path, bytes);
  if (contentKind === "image") {
    return {
      path,
      content: "",
      sizeBytes,
      contentKind,
    };
  }
  if (contentKind === "binary") {
    const maxBinaryOpenAsTextBytes =
      options?.maxBinaryOpenAsTextBytes ??
      appState.getSnapshot().settings.externalFiles.maxBinaryOpenAsTextBytes ??
      DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES;
    const resolved = resolveBinaryFileOpen(bytes, sizeBytes, maxBinaryOpenAsTextBytes);
    return {
      path,
      content: resolved.content,
      sizeBytes,
      contentKind: resolved.contentKind,
    };
  }
  const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return {
    path,
    content,
    sizeBytes,
    contentKind: "text",
  };
}
