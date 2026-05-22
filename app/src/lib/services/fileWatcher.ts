import { invoke } from "@tauri-apps/api/core";

export const FILE_CHANGED_EVENT = "spec-ops/fs/file-changed";

export async function syncFileWatcherPaths(paths: string[]): Promise<void> {
  await invoke("sync_file_watcher_paths", { paths });
}

export async function clearFileWatcherPaths(): Promise<void> {
  await invoke("sync_file_watcher_paths", { paths: [] });
}
