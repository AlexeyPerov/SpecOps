import { emit, listen } from "@tauri-apps/api/event";
import { appState } from "../state/appState";
import { persistGlobalRecentFiles } from "./sessionManager";

export const WINDOW_EVENT_RECENT_FILES_CHANGED = "spec-ops/window/recent-files-changed";

export async function commitRecentFiles(recentFiles: string[]): Promise<void> {
  await persistGlobalRecentFiles(recentFiles);
  await emit(WINDOW_EVENT_RECENT_FILES_CHANGED, { recentFiles });
}

export async function listenForRecentFilesChanges(
  onRecentFilesChanged: (recentFiles: string[]) => void,
): Promise<() => void> {
  const unlisten = await listen<{ recentFiles: string[] }>(
    WINDOW_EVENT_RECENT_FILES_CHANGED,
    (event) => {
      appState.replaceRecentFiles(event.payload.recentFiles);
      onRecentFilesChanged(event.payload.recentFiles);
    },
  );
  return unlisten;
}
