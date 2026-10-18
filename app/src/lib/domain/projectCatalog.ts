import type { ContextSnapshot } from './workspace';

/** A project identity is its normalized root, never an open context's ws-* id. */
export type ProjectId = string;
export interface CatalogProject {
  id: ProjectId;
  rootPath: string;
  name: string;
  folderId: string | null;
  order: number;
  pinned: boolean;
  pinnedOrder: number;
  hiddenFromRail: boolean;
  documentStorage: 'app' | 'project';
  color?: string;
  icon?: string;
  lastUsedAt?: string;
  openError?: string;
}
export interface ProjectFolder {
  id: string;
  name: string;
  order: number;
}
/** Persisted separately from live contexts; it owns no editor or watcher. */
export interface SavedProjectContext {
  savedAt: string;
  snapshot: ContextSnapshot;
}
export interface ProjectCatalog {
  version: 1;
  revision: number;
  projects: Record<ProjectId, CatalogProject>;
  folders: Record<string, ProjectFolder>;
  savedContexts: Record<ProjectId, SavedProjectContext>;
}
