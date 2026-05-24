import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import type { DiskFingerprint } from "../domain/contracts";
import { statDiskFingerprint } from "./diskFingerprint";
import { recordWriteFingerprint } from "./externalFileChanges";
import { appState } from "../state/appState";

export interface OpenedFile {
  path: string;
  content: string;
  sizeBytes: number;
}

export interface FileSavePayload {
  path: string;
  content: string;
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
  await writeTextFile(payload.path, payload.content);
  const fingerprint = await statDiskFingerprint(payload.path);
  recordWriteFingerprint(payload.path, fingerprint);
  return fingerprint;
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
  await writeTextFile(selectedPath, content);
  const fingerprint = await statDiskFingerprint(selectedPath);
  recordWriteFingerprint(selectedPath, fingerprint);
  return { path: selectedPath, fingerprint };
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

export async function openPath(path: string): Promise<OpenedFile> {
  const content = await readTextFile(path);
  return {
    path,
    content,
    sizeBytes: new TextEncoder().encode(content).length,
  };
}
