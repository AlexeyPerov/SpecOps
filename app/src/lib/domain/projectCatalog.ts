import type { ContextSnapshot } from './workspace';
import type { DocumentState } from './document';

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
  snapshot: Omit<ContextSnapshot, 'documents'> & { documents: SavedProjectDocument[] };
  recoveryRef?: string;
}
/** File contents never enter the catalog or its subscribers. */
export type SavedProjectDocument = Omit<DocumentState, 'content' | 'savedContent' | 'isDirty'>;
export type ProjectRecoveryBuffers = Record<string, Pick<DocumentState, 'content' | 'savedContent' | 'isDirty'>>;
export type SavedProjectContextWrite = SavedProjectContext & { recoveryBuffers?: ProjectRecoveryBuffers };
/** App-wide Tasks or Notes document; not tied to any project. */
export interface GlobalDocument {
  id: string;
  kind: 'tasks' | 'notes';
  name: string;
  order: number;
}
export interface ProjectCatalog {
  version: 1;
  revision: number;
  projects: Record<ProjectId, CatalogProject>;
  folders: Record<string, ProjectFolder>;
  savedContexts: Record<ProjectId, SavedProjectContext>;
  documents: Record<string, GlobalDocument>;
}
