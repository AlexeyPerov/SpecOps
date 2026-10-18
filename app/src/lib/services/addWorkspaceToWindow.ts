import { workspaceContextIsClosing } from './workspaceContextTransition';
import { claimOpenFile, syncOpenFileRegistryForWindow } from './openFileRegistry';
import { restoreSavedProjectContext } from './workspaceSavedContext';
import { markWorkspaceLifecycleActive } from './workspaceLifecycle';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { stat } from '@tauri-apps/plugin-fs';
import { getProjectCatalog, loadProjectCatalog, projectIdentity, registerCatalogProjects, updateCatalogProject } from './workspaceCatalog';
import { ensureWorkspaceReadAccess } from './fileSystem';
import { normalizePathSync } from './diskFingerprint';
import { appState } from '../state/appState';
import { focusExistingWorkspaceWindow } from './workspaceWindowTransfer';
import { markWorkspaceOutgoing, setWorkspaceWindowOwner, workspaceWindowOwner } from './workspaceWindowPlacement';
import type { ContextId } from '../domain/contracts';
const opening = new Map<string, Promise<ContextId | null>>();
/** One pending open per normalized root also covers asynchronous saved-context restore. */
export function addWorkspaceToWindow(root: string): Promise<ContextId | null> {
  const key = normalizePathSync(root);
  const existing = opening.get(key);
  if (existing) return existing;
  const pending = openWorkspace(root);
  opening.set(key, pending);
  const release = () => { if (opening.get(key) === pending) opening.delete(key); };
  void pending.then(release, release);
  return pending;
}
/** Opening an existing workspace activates its owning window. */
async function openWorkspace(root: string): Promise<ContextId | null> {
  if (workspaceContextIsClosing(root)) throw new Error('Workspace is still closing. Try opening it again after the operation finishes.');
  if ((typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) && await focusExistingWorkspaceWindow(root)) return null;
  const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const existing = appState.getWindowSessionSnapshot().workspaces.find(entry => normalizePathSync(entry.rootPath) === normalizePathSync(root));
  try {
    if (native && await ensureWorkspaceReadAccess(root) === 'blocked') throw new Error('Workspace path is inaccessible. Check permissions and try again.');
    if (native && !(await stat(root)).isDirectory) throw new Error('Workspace directory is unavailable.');
    if (existing) {
      if (getProjectCatalog().projects[projectIdentity(root)]?.openError) await updateCatalogProject(root, { openError: null });
      appState.switchContext(existing.id); markWorkspaceLifecycleActive(); return null;
    }
    await registerCatalogProjects([root]);
  } catch (error) {
    // A failed new path is never registered; an existing catalog entry retains its error.
    await loadProjectCatalog().catch(() => {});
    if (getProjectCatalog().projects[projectIdentity(root)]) await updateCatalogProject(root, { openError: String(error) }).catch(() => {});
    throw error;
  }
  const oldOwner = native ? await workspaceWindowOwner(root) : undefined;
  const previousContextId = appState.getSnapshot().contexts.activeContextId;
  const restored = await restoreSavedProjectContext(root);
  const windowId = native ? getCurrentWebviewWindow().label : 'main';
  const id = restored ? appState.adoptWorkspace({ id: 'ws-0', rootPath: root, snapshot: restored }, windowId, { deferActivation: true })
    : appState.addWorkspace(root, { deferActivation: true });
  if (!id) return null;
  let claimed = false;
  try {
    if (native) { await setWorkspaceWindowOwner(root, windowId, oldOwner ?? null); claimed = true; }
    if (getProjectCatalog().projects[projectIdentity(root)]?.openError) await updateCatalogProject(root, { openError: null });
    if (restored) {
      const entry = appState.getSnapshot().contexts.workspaces.find(workspace => workspace.id === id)!;
      for (const doc of entry.snapshot.documents) if (doc.filePath) {
        const owner = await claimOpenFile(doc.filePath, windowId, doc.id);
        if (owner) throw new Error(`File is already open in another window: ${doc.filePath}`);
      }
    }
    appState.confirmWorkspaceActivation(id);
    markWorkspaceLifecycleActive();
    markWorkspaceOutgoing(root, false);
    return id;
  } catch (error) { appState.closeWorkspace(id, { deferActivation: true }); appState.switchContext(previousContextId);
    if (native && claimed) await setWorkspaceWindowOwner(root, oldOwner ?? null, windowId).catch(() => {});
    if (restored) await syncOpenFileRegistryForWindow(windowId, appState.getSnapshot()).catch(() => {});
    if (native && await focusExistingWorkspaceWindow(root).catch(() => false)) return null;
    await updateCatalogProject(root, { openError: String(error) }).catch(() => {});
    throw error; }
}
