import { stat } from "@tauri-apps/plugin-fs";
import { getErrorMessage } from "../commands/commandErrors";
import { appState } from "../state/appState";
import { normalizePathForStorage } from "./diskFingerprint";
import { ensureWorkspaceReadAccess } from "./fileSystem";
import { markWorkspaceLifecycleActive } from "./workspaceLifecycle";
import { showErrorToast } from "./toastBus";
import type { OpenActivePathResult, OpenPathActivationOptions } from "./openActivePath";

/** Opener callback supplied by the shell; see `createAppShellFileHandlers`. */
export type OpenDroppedFileFn = (
  path: string,
  options?: OpenPathActivationOptions,
) => Promise<OpenActivePathResult | void>;

/**
 * Open a path dropped onto the window: files go through `openFile`, directories
 * become workspaces. Avoids treating a folder as a file (which surfaces a raw
 * "Is a directory" OS error). Failures raise a visible toast — the status-bar
 * line alone was easy to miss and made failed drops look like silent no-ops.
 */
export async function openDroppedPath(
  path: string,
  openFile: OpenDroppedFileFn,
  notify: (message: string) => void,
): Promise<void> {
  try {
    const info = await stat(path);
    if (info.isDirectory) {
      await addDroppedWorkspace(path, notify);
      return;
    }
    // The drop itself is the explicit user gesture, so the large-file confirm
    // threshold does not apply (a hard ceiling still guards pathological sizes).
    const result = await openFile(path, { bypassLargeFileGate: true });
    if (result?.kind === "failed") {
      showErrorToast(`Failed to open dropped file: ${result.reason}`);
    } else if (result?.kind === "missing") {
      showErrorToast(`Dropped file no longer exists: ${result.path}`);
    }
  } catch (error: unknown) {
    notify(`Failed to open dropped path: ${getErrorMessage(error)}`);
    showErrorToast(`Failed to open dropped path: ${getErrorMessage(error)}`);
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
    showErrorToast("Dropped workspace is inaccessible. Check permissions and try again.");
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
