import { markWorkspaceLifecycleActive } from './workspaceLifecycle';
import { stat } from '@tauri-apps/plugin-fs';
import { appState } from '../state/appState';
import { ensureWorkspaceReadAccess } from './fileSystem';
import { workspaceWasMovedOut } from './workspaceWindowPlacement';

/** Previous means the last successfully activated, still-open local context. */
export async function activatePreviousWorkspace(notify: (message: string) => void): Promise<void> {
  const history = appState.getWorkspaceActivationHistory();
  const active = appState.getSnapshot().contexts.activeContextId;
  // Manager opens in Notepad; it must preserve the same previous project.
  const candidates = history.filter((id, index) => id !== active && !(active === 'notepad' && index === 0));
  for (const id of candidates) {
    const workspace = appState.getSnapshot().contexts.workspaces.find(entry => entry.id === id);
    if (!workspace || workspaceWasMovedOut(workspace.rootPath)) continue;
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      try { if (await ensureWorkspaceReadAccess(workspace.rootPath) === 'blocked' || !(await stat(workspace.rootPath)).isDirectory) continue; }
      catch { continue; }
    }
    if (appState.getSnapshot().contexts.workspaces.some(entry => entry.id === id) && !workspaceWasMovedOut(workspace.rootPath)) {
      appState.switchContext(id); markWorkspaceLifecycleActive(); return;
    }
  }
  notify('No previous accessible workspace is open in this window.');
}
