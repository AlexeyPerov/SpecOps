import { invoke } from "@tauri-apps/api/core";

export const FILE_CHANGED_EVENT = "spec-ops/fs/file-changed";

/**
 * Coarse filesystem-event kind emitted alongside each watched path by the
 * native watcher. Mirrors the Rust `FileChangeKind` enum (serde `rename_all =
 * "lowercase"`). Consumers use this to apply incremental catalog invalidation
 * safely and fall back to a debounced rebuild when the kind is `Other`.
 */
export type FileWatcherEventKind = "create" | "remove" | "modify" | "rename" | "other";

/** Payload of the {@link FILE_CHANGED_EVENT} emitted from the native watcher. */
export interface FileWatcherEventPayload {
  path: string;
  kind: FileWatcherEventKind;
}

export async function syncFileWatcherPaths(paths: string[]): Promise<void> {
  await invoke("sync_file_watcher_paths", { paths });
}

export async function clearFileWatcherPaths(): Promise<void> {
  await invoke("sync_file_watcher_paths", { paths: [] });
}

export async function syncProjectTreeWatcher(root: string | null): Promise<void> {
  await invoke("sync_project_tree_watcher", { root });
}
