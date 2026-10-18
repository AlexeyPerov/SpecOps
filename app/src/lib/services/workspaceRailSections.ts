import type { CatalogProject, ProjectCatalog } from '../domain/projectCatalog';
import type { ContextId, WorkspaceEntry } from '../domain/contracts';
import { catalogProjectForRoot, projectIdentity } from './workspaceCatalog';
import type { WorkspaceWindowOwners } from './workspaceWindowPlacement';

export interface RailProject extends CatalogProject { contextId?: ContextId }
export interface RailSection { id: string; name: string; folderId: string | null; pinned: boolean; projects: RailProject[] }
export const PINNED_SECTION = 'pinned';
export const UNFILED_SECTION = 'unfiled';
export function folderSectionId(id: string): string { return `folder:${id}`; }
/** Projection only: no contexts, watchers or Git work are created for closed entries. */
export function workspaceRailSections(catalog: ProjectCatalog, workspaces: WorkspaceEntry[], owners: WorkspaceWindowOwners,
  windowId: string, query = ''): RailSection[] {
  const open = new Map(workspaces.map(workspace => [projectIdentity(workspace.rootPath), workspace]));
  const projects = { ...catalog.projects };
  // During the initial catalog read, already restored contexts remain usable.
  for (const workspace of workspaces) if (!projects[projectIdentity(workspace.rootPath)]) {
    const project = catalogProjectForRoot(workspace.rootPath); projects[project.id] = project;
  }
  const needle = query.trim().toLocaleLowerCase();
  const visible = Object.values(projects).filter(project => !project.hiddenFromRail &&
    (!owners[project.id] || owners[project.id] === windowId || open.has(project.id)) &&
    (!needle || `${project.name}\n${project.rootPath}`.toLocaleLowerCase().includes(needle)))
    .map(project => ({ ...project, contextId: open.get(project.id)?.id }));
  const ordered = (projects: RailProject[], pinned = false) => projects.sort((a, b) =>
    (pinned ? a.pinnedOrder - b.pinnedOrder : a.order - b.order) || a.id.localeCompare(b.id));
  const sections: RailSection[] = [{ id: PINNED_SECTION, name: 'Pinned', folderId: null, pinned: true,
    projects: ordered(visible.filter(project => project.pinned), true) }];
  const folders = Object.values(catalog.folders).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  for (const folder of folders) sections.push({ id: folderSectionId(folder.id), name: folder.name, folderId: folder.id,
    pinned: false, projects: ordered(visible.filter(project => !project.pinned && project.folderId === folder.id)) });
  sections.push({ id: UNFILED_SECTION, name: 'Without folder', folderId: null, pinned: false,
    projects: ordered(visible.filter(project => !project.pinned && project.folderId === null)) });
  return sections;
}
export interface RailWindowPreferences { collapsed: string[]; scrollTop: number }
export function readRailWindowPreferences(windowId: string): RailWindowPreferences {
  try { const value = JSON.parse(localStorage.getItem(`spec-ops:workspace-rail:${windowId}`) ?? 'null');
    return { collapsed: Array.isArray(value?.collapsed) ? value.collapsed.filter((id: unknown) => typeof id === 'string') : [],
      scrollTop: typeof value?.scrollTop === 'number' && Number.isFinite(value.scrollTop) ? Math.max(0, value.scrollTop) : 0 };
  } catch { return { collapsed: [], scrollTop: 0 }; }
}
export function writeRailWindowPreferences(windowId: string, value: RailWindowPreferences): void {
  try { localStorage.setItem(`spec-ops:workspace-rail:${windowId}`, JSON.stringify(value)); } catch { /* Optional UI preferences can be unavailable. */ }
}
