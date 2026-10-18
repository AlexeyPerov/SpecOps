import type { CatalogProject, ProjectCatalog } from '../domain/projectCatalog';
import type { ContextId, WorkspaceEntry } from '../domain/contracts';
import { getProjectCatalog, projectIdentity, updateProjectCatalog, type CatalogMutation } from './workspaceCatalog';
import { readLiveWorkspaceWindowOwners, type WorkspaceWindowOwners } from './workspaceWindowPlacement';
import { appState } from '../state/appState';

export type ManagerScope = 'all' | 'here' | 'other' | 'closed' | 'hidden';
export type ManagerSort = 'manual' | 'name' | 'recent';
export type ManagerProject = CatalogProject & { contextId?: ContextId; ownerId?: string; openState: 'here' | 'other' | 'closed' };
export function managerProjects(catalog: ProjectCatalog, workspaces: WorkspaceEntry[], owners: WorkspaceWindowOwners): ManagerProject[] {
  const rows = new Map<string, ManagerProject>();
  for (const project of Object.values(catalog.projects)) rows.set(project.id, { ...project, ownerId: owners[project.id], openState: owners[project.id] ? 'other' : 'closed' });
  for (const workspace of workspaces) {
    const id = projectIdentity(workspace.rootPath);
    const project = rows.get(id) ?? { id, rootPath: workspace.rootPath, name: workspace.rootPath.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? workspace.rootPath,
      folderId: null, order: 0, pinnedOrder: 0, pinned: false, hiddenFromRail: false, documentStorage: 'app' as const };
    rows.set(id, { ...project, contextId: workspace.id, openState: 'here' });
  }
  return [...rows.values()];
}
export function sortManagerProjects(rows: ManagerProject[], sort: ManagerSort, folders: ProjectCatalog['folders'] = {}): ManagerProject[] {
  const manualOrder = (a: ManagerProject, b: ManagerProject): number => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned) return a.pinnedOrder - b.pinnedOrder;
    const group = (project: ManagerProject) => project.folderId ? folders[project.folderId]?.order ?? Infinity : Infinity;
    return (group(a) - group(b)) || (a.folderId ?? '').localeCompare(b.folderId ?? '') || a.order - b.order;
  };
  return [...rows].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'recent'
    ? (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') : manualOrder(a, b)) || a.id.localeCompare(b.id));
}
export type CatalogBatchAction = { type: 'folder'; folderId: string | null } | { type: 'pin'; value: boolean } | { type: 'hidden'; value: boolean };
export type CatalogBatchResult = { succeeded: string[]; errors: { id: string; message: string }[] };
/** Patch only the selected semantic field; one transaction commits all eligible rows. */
export async function applyCatalogBatch(ids: string[], action: CatalogBatchAction): Promise<CatalogBatchResult> {
  const catalog = getProjectCatalog();
  const result: CatalogBatchResult = { succeeded: [], errors: [] };
  const mutations: CatalogMutation[] = [];
  for (const id of new Set(ids)) {
    if (!catalog.projects[id]) { result.errors.push({ id, message: 'Project is no longer in the catalog.' }); continue; }
    if (action.type === 'folder' && action.folderId && !catalog.folders[action.folderId]) { result.errors.push({ id, message: 'Folder is no longer available.' }); continue; }
    mutations.push(action.type === 'folder' ? { type: 'moveProject', id, folderId: action.folderId }
      : action.type === 'pin' ? { type: 'moveProject', id, pinned: action.value }
        : { type: 'updateProject', id, patch: { hiddenFromRail: action.value } });
  }
  if (mutations.length) {
    try { await updateProjectCatalog(mutations); result.succeeded = mutations.map(mutation => 'id' in mutation ? mutation.id : ''); }
    catch (error) { result.errors.push(...mutations.map(mutation => ({ id: 'id' in mutation ? mutation.id : '', message: String(error) }))); }
  }
  return result;
}
export async function removeClosedCatalogProject(id: string): Promise<void> {
  const owners = await readLiveWorkspaceWindowOwners();
  if (owners[id] || appState.getSnapshot().contexts.workspaces.some(workspace => projectIdentity(workspace.rootPath) === id)) {
    throw new Error('Close the workspace in its owning window before removing it from the catalog.');
  }
  await updateProjectCatalog([{ type: 'removeProject', id }]);
}
