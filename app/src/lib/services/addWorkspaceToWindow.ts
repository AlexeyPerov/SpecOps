import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { stat } from '@tauri-apps/plugin-fs';
import { getProjectCatalog, loadProjectCatalog, projectIdentity, registerCatalogProjects, updateCatalogProject } from './workspaceCatalog';
import { ensureWorkspaceReadAccess } from './fileSystem';
import { normalizePathSync } from './diskFingerprint';
import { appState } from '../state/appState';
import { focusExistingWorkspaceWindow } from './workspaceWindowTransfer';
import { markWorkspaceOutgoing, setWorkspaceWindowOwner, workspaceWindowOwner } from './workspaceWindowPlacement';
import type { ContextId } from '../domain/contracts';
/** Opening an existing workspace activates its owning window. */
export async function addWorkspaceToWindow(root: string): Promise<ContextId | null> {
  if ((typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) && await focusExistingWorkspaceWindow(root)) return null;
  const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const existing = appState.getWindowSessionSnapshot().workspaces.find(entry => normalizePathSync(entry.rootPath) === normalizePathSync(root));
  if (existing) { appState.switchContext(existing.id); return null; }
  try {
    if (native && await ensureWorkspaceReadAccess(root) === 'blocked') throw new Error('Workspace path is inaccessible. Check permissions and try again.');
    if (native && !(await stat(root)).isDirectory) throw new Error('Workspace directory is unavailable.');
    await registerCatalogProjects([root]);
  } catch (error) {
    // A failed new path is never registered; an existing catalog entry retains its error.
    await loadProjectCatalog().catch(() => {});
    if (getProjectCatalog().projects[projectIdentity(root)]) await updateCatalogProject(root, { openError: String(error) }).catch(() => {});
    throw error;
  }
  const oldOwner = native ? await workspaceWindowOwner(root) : undefined;
  const id = appState.addWorkspace(root);
  if (!id) return null;
  try {
    if ((typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)) await setWorkspaceWindowOwner(root, getCurrentWebviewWindow().label, oldOwner ?? null);
    if (getProjectCatalog().projects[projectIdentity(root)]?.openError) await updateCatalogProject(root, { openError: null });
    markWorkspaceOutgoing(root, false);
    return id;
  } catch (error) { appState.closeWorkspace(id);
    if (native) await setWorkspaceWindowOwner(root, oldOwner ?? null, getCurrentWebviewWindow().label).catch(() => {});
    if (native && await focusExistingWorkspaceWindow(root).catch(() => false)) return null;
    await updateCatalogProject(root, { openError: String(error) }).catch(() => {});
    throw error; }
}
