import { emit, listen } from "@tauri-apps/api/event";
import { appState } from "../state/appState";
import { logDiagnostic } from "./logging";
import { persistGlobalRecentFiles } from "./sessionManager";

export const WINDOW_EVENT_RECENT_FILES_CHANGED = "spec-ops/window/recent-files-changed";

let recentFilesBatchDepth = 0;
let pendingRecentFilesCommit: string[] | null = null;

export async function commitRecentFiles(recentFiles: string[]): Promise<void> {
  await logDiagnostic({
    level: "debug",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "recentFiles: commit",
    metadata: { recentCount: recentFiles.length, batchDepth: recentFilesBatchDepth },
  });
  await persistGlobalRecentFiles(recentFiles);
  await emit(WINDOW_EVENT_RECENT_FILES_CHANGED, { recentFiles });
}

export function syncRecentFiles(recentFiles: string[]): void {
  if (recentFilesBatchDepth > 0) {
    pendingRecentFilesCommit = recentFiles;
    void logDiagnostic({
      level: "debug",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "recentFiles: deferred during batch",
      metadata: { recentCount: recentFiles.length, batchDepth: recentFilesBatchDepth },
    });
    return;
  }
  void commitRecentFiles(recentFiles);
}

export async function runWithRecentFilesBatch<T>(operation: () => Promise<T>): Promise<T> {
  recentFilesBatchDepth += 1;
  try {
    return await operation();
  } finally {
    recentFilesBatchDepth -= 1;
    if (recentFilesBatchDepth === 0 && pendingRecentFilesCommit !== null) {
      const recentFiles = pendingRecentFilesCommit;
      pendingRecentFilesCommit = null;
      await commitRecentFiles(recentFiles);
    }
  }
}

/** Clears batch state between unit tests. */
export function resetRecentFilesSyncForTests(): void {
  recentFilesBatchDepth = 0;
  pendingRecentFilesCommit = null;
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
