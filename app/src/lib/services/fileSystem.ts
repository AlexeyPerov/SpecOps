import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, rename, stat, writeTextFile } from "@tauri-apps/plugin-fs";

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
  const selectedPath = await open({
    title: "Open File",
    multiple: false,
    directory: false,
  });
  if (!selectedPath || Array.isArray(selectedPath)) {
    return null;
  }
  return openPath(selectedPath);
}

export async function saveFile(payload: FileSavePayload): Promise<void> {
  await writeTextFile(payload.path, payload.content);
}

export async function saveFileAs(content: string): Promise<string | null> {
  const selectedPath = await save({
    title: "Save File As",
  });
  if (!selectedPath) {
    return null;
  }
  await writeTextFile(selectedPath, content);
  return selectedPath;
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
  const [content, fileStat] = await Promise.all([readTextFile(path), stat(path)]);
  return {
    path,
    content,
    sizeBytes: fileStat.size,
  };
}
