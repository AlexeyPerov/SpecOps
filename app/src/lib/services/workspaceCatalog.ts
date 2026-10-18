import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { normalizePathForStorage, normalizePathSync } from './diskFingerprint';
import type { CatalogProject, ProjectCatalog, ProjectFolder, SavedProjectContextWrite } from '../domain/projectCatalog';

export type ProjectPatch = Partial<Omit<CatalogProject, 'id' | 'rootPath' | 'openError' | 'color' | 'icon'>> & { openError?: string | null; color?: string | null; icon?: string | null };
export type CatalogMutation =
  | { type: 'register'; project: CatalogProject }
  | { type: 'updateProject'; id: string; patch: ProjectPatch }
  | { type: 'putFolder'; folder: ProjectFolder }
  | { type: 'moveProject'; id: string; folderId?: string | null; pinned?: boolean; beforeId?: string | null }
  | { type: 'moveFolder'; id: string; beforeId?: string | null }
  | { type: 'renameFolder'; id: string; name: string }
  | { type: 'removeFolder' | 'removeProject'; id: string }
  | { type: 'saveContext'; id: string; context: SavedProjectContextWrite };

const emptyCatalog = (): ProjectCatalog => ({ version: 1, revision: 0, projects: {}, folders: {}, savedContexts: {} });
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
let cache = deepFreeze(emptyCatalog());
const subscribers = new Set<(catalog: ProjectCatalog) => void>();
export const projectIdentity = normalizePathSync;
/**
 * The committed catalog is deeply frozen, so callers share it without copying and
 * cannot change it before commit; derive new values instead of mutating.
 */
export function getProjectCatalog(): ProjectCatalog { return cache; }
function publish(next: ProjectCatalog): ProjectCatalog {
  // A cross-window event/read can finish before the earlier local invoke.
  if (next.revision >= cache.revision) {
    cache = deepFreeze(next);
    for (const subscriber of subscribers) {
      try { subscriber(cache); } catch (error) { console.error(error); }
    }
  }
  return cache;
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
export function saveCatalogProjectContext(root: string, context: SavedProjectContextWrite): Promise<ProjectCatalog> {
  return saveCatalogProjectContexts([{ root, context }]);
}
/** One transaction for many projects: a single catalog write and change event. */
export function saveCatalogProjectContexts(entries: { root: string; context: SavedProjectContextWrite }[]): Promise<ProjectCatalog> {
  return updateProjectCatalog(entries.flatMap(({ root, context }): CatalogMutation[] => [
    { type: 'register', project: catalogProjectForRoot(root) },
    { type: 'saveContext', id: projectIdentity(root), context }]));
}
const PROJECT_USE_FLUSH_MS = 1500;
const pendingProjectUse = new Map<string, string>();
let projectUseTimer: ReturnType<typeof setTimeout> | undefined;
/** Coalesce recency updates: a burst of workspace switches costs one catalog write. */
export function recordCatalogProjectUse(root: string, at = new Date().toISOString()): void {
  pendingProjectUse.set(projectIdentity(root), at);
  projectUseTimer ??= setTimeout(() => { void flushCatalogProjectUse().catch(console.error); }, PROJECT_USE_FLUSH_MS);
}
export async function flushCatalogProjectUse(): Promise<void> {
  if (projectUseTimer) clearTimeout(projectUseTimer);
  projectUseTimer = undefined;
  // Projects removed meanwhile are skipped so one stale id cannot fail the batch.
  const mutations: CatalogMutation[] = [...pendingProjectUse].filter(([id]) => cache.projects[id])
    .map(([id, lastUsedAt]) => ({ type: 'updateProject', id, patch: { lastUsedAt } }));
  pendingProjectUse.clear();
  if (mutations.length) await updateProjectCatalog(mutations);
}
export function _resetProjectCatalogForTests(): void {
  cache = deepFreeze(emptyCatalog()); subscribers.clear();
  if (projectUseTimer) clearTimeout(projectUseTimer);
  projectUseTimer = undefined; pendingProjectUse.clear();
}
