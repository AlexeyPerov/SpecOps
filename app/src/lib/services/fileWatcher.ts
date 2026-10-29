import { invoke } from "@tauri-apps/api/core";

export const FILE_WATCHER_ERROR_EVENT = "spec-ops/fs/watcher-error";

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

export async function syncProjectTreeWatcher(roots: readonly string[]): Promise<void> {
  await invoke("sync_project_tree_watcher", { roots });
}

/**
 * Mutes watcher events under directories the app is about to delete
 * recursively, so a large delete is reported once per root instead of once per
 * file to every window. Best-effort: the events are only redundant.
 */
export async function suppressWatcherSubtreeEvents(paths: readonly string[]): Promise<void> {
  try {
    await invoke("suppress_watcher_subtree_events", { paths });
  } catch {
    // Without suppression the per-file events still arrive and are handled.
  }
}
