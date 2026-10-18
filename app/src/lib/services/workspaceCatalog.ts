import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { normalizePathForStorage, normalizePathSync } from './diskFingerprint';
import type { CatalogProject, ProjectCatalog, ProjectFolder, SavedProjectContext } from '../domain/projectCatalog';

export type ProjectPatch = Partial<Omit<CatalogProject, 'id' | 'rootPath' | 'openError' | 'color' | 'icon'>> & { openError?: string | null; color?: string | null; icon?: string | null };
export type CatalogMutation =
  | { type: 'register'; project: CatalogProject }
  | { type: 'updateProject'; id: string; patch: ProjectPatch }
  | { type: 'putFolder'; folder: ProjectFolder }
  | { type: 'removeFolder' | 'removeProject'; id: string }
  | { type: 'saveContext'; id: string; context: SavedProjectContext };

const emptyCatalog = (): ProjectCatalog => ({ version: 1, revision: 0, projects: {}, folders: {}, savedContexts: {} });
let cache = emptyCatalog();
const subscribers = new Set<(catalog: ProjectCatalog) => void>();
export const projectIdentity = normalizePathSync;
/** Detached snapshots prevent callers from changing the shared cache before commit. */
export function getProjectCatalog(): ProjectCatalog { return structuredClone(cache); }
function publish(next: ProjectCatalog): ProjectCatalog {
  // A cross-window event/read can finish before the earlier local invoke.
  if (next.revision >= cache.revision) {
    cache = structuredClone(next);
    for (const subscriber of subscribers) {
      try { subscriber(getProjectCatalog()); } catch (error) { console.error(error); }
    }
  }
  return getProjectCatalog();
}
export async function updateProjectCatalog(mutations: CatalogMutation[]): Promise<ProjectCatalog> {
  return publish(await invoke<ProjectCatalog>('project_catalog_transaction', { mutations }));
}
export function loadProjectCatalog(): Promise<ProjectCatalog> { return updateProjectCatalog([]); }
export function subscribeProjectCatalog(subscriber: (catalog: ProjectCatalog) => void): () => void {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}
export function listenProjectCatalogChanges(): Promise<() => void> {
  return listen<number>('spec-ops/project-catalog-changed', ({ payload }) => {
    if (payload > cache.revision) void loadProjectCatalog().catch(console.error);
  });
}
export function catalogProjectForRoot(root: string): CatalogProject {
  const rootPath = normalizePathForStorage(root);
  return { id: projectIdentity(rootPath), rootPath, name: rootPath.split('/').filter(Boolean).at(-1) || rootPath,
    folderId: null, order: 0, pinned: false, pinnedOrder: 0, hiddenFromRail: false, documentStorage: 'app' };
}
export async function registerCatalogProjects(roots: string[]): Promise<ProjectCatalog> {
  if (!roots.length) return getProjectCatalog();
  return updateProjectCatalog(roots.map(root => ({ type: 'register', project: catalogProjectForRoot(root) })));
}
export function updateCatalogProject(root: string, patch: ProjectPatch): Promise<ProjectCatalog> {
  // Registration is idempotent and shares the transaction with preference changes.
  return updateProjectCatalog([{ type: 'register', project: catalogProjectForRoot(root) },
    { type: 'updateProject', id: projectIdentity(root), patch }]);
}
export function saveCatalogProjectContext(root: string, context: SavedProjectContext): Promise<ProjectCatalog> {
  return updateProjectCatalog([{ type: 'register', project: catalogProjectForRoot(root) },
    { type: 'saveContext', id: projectIdentity(root), context }]);
}
export function _resetProjectCatalogForTests(): void { cache = emptyCatalog(); subscribers.clear(); }
