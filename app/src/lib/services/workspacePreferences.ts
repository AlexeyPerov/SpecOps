/** Preferences are a view of the project catalog, with no independent persisted state. */
import { getProjectCatalog, loadProjectCatalog, listenProjectCatalogChanges, projectIdentity,
  subscribeProjectCatalog, updateCatalogProject, _resetProjectCatalogForTests } from './workspaceCatalog';
export type WorkspaceDocumentStorage = 'app' | 'project';
export function getHiddenRootPaths(): Set<string> {
  return new Set(Object.values(getProjectCatalog().projects).filter(project => project.hiddenFromRail).map(project => project.id));
}
export function isHiddenFromRail(root: string): boolean { return getProjectCatalog().projects[projectIdentity(root)]?.hiddenFromRail === true; }
export async function loadWorkspacePreferences(): Promise<Set<string>> { await loadProjectCatalog(); return getHiddenRootPaths(); }
export async function setHiddenFromRail(root: string, hiddenFromRail: boolean): Promise<void> { await updateCatalogProject(root, { hiddenFromRail }); }
export function subscribeWorkspacePreferences(listener: (hiddenPaths: Set<string>) => void): () => void {
  return subscribeProjectCatalog(() => listener(getHiddenRootPaths()));
}
export function getWorkspaceDocumentStorage(root: string): WorkspaceDocumentStorage { return getProjectCatalog().projects[projectIdentity(root)]?.documentStorage ?? 'app'; }
export async function setWorkspaceDocumentStorage(root: string, documentStorage: WorkspaceDocumentStorage): Promise<void> { await updateCatalogProject(root, { documentStorage }); }
export const listenWorkspacePreferenceChanges = listenProjectCatalogChanges;
export const _resetWorkspacePreferencesForTests = _resetProjectCatalogForTests;
