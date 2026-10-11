import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { appState } from '../state/appState';
import { focusExistingWorkspaceWindow } from './workspaceWindowTransfer';
import { markWorkspaceOutgoing, setWorkspaceWindowOwner, workspaceWindowOwner } from './workspaceWindowPlacement';
import type { ContextId } from '../domain/contracts';
/** Opening an existing workspace activates its owning window. */
export async function addWorkspaceToWindow(root: string): Promise<ContextId | null> {
  if ((typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) && await focusExistingWorkspaceWindow(root)) return null;
  const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const oldOwner = native ? await workspaceWindowOwner(root) : undefined;
  const id = appState.addWorkspace(root);
  if (!id) return null;
  try {
    if ((typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)) await setWorkspaceWindowOwner(root, getCurrentWebviewWindow().label, oldOwner ?? null);
    markWorkspaceOutgoing(root, false);
    return id;
  } catch (error) { appState.closeWorkspace(id); throw error; }
}
