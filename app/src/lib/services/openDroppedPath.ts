import { stat } from "@tauri-apps/plugin-fs";
import { getErrorMessage } from "../commands/commandErrors";
import { appState } from "../state/appState";
import { normalizePathForStorage } from "./diskFingerprint";
import { ensureWorkspaceReadAccess } from "./fileSystem";
import { markWorkspaceLifecycleActive } from "./workspaceLifecycle";

/**
 * Open a path dropped onto the window: files go through `openFile`, directories
 * become workspaces. Avoids treating a folder as a file (which surfaces a raw
 * "Is a directory" OS error).
 */
export async function openDroppedPath(
  path: string,
  openFile: (path: string) => Promise<void>,
  notify: (message: string) => void,
): Promise<void> {
  try {
    const info = await stat(path);
    if (info.isDirectory) {
      await addDroppedWorkspace(path, notify);
      return;
    }
    await openFile(path);
  } catch (error: unknown) {
    notify(`Failed to open dropped path: ${getErrorMessage(error)}`);
  }
}

async function addDroppedWorkspace(
  path: string,
  notify: (message: string) => void,
): Promise<void> {
  const storedRoot = normalizePathForStorage(path);
  const accessStatus = await ensureWorkspaceReadAccess(storedRoot);
  if (accessStatus === "blocked") {
    notify("Workspace path is inaccessible. Check permissions and try again.");
    return;
  }
  const workspaceId = appState.addWorkspace(storedRoot);
  if (!workspaceId) {
    notify("Workspace is already open.");
    return;
  }
  markWorkspaceLifecycleActive();
  notify("Workspace added.");
}
