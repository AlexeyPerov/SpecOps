import type { GlobalDocument, ProjectCatalog, ProjectFolder, RailPlacement } from '../domain/projectCatalog';
import type { RailTabGroup } from './railTabGroups';
import type { RailProject } from './workspaceRailSections';

export type RailItem = RailPlacement & { key: string; name: string } & (
  | { kind: 'workspace'; project: RailProject }
  | { kind: 'tabGroup'; group: RailTabGroup }
  | { kind: 'tasks' | 'notes'; document: GlobalDocument }
  | { kind: 'folder'; folder: ProjectFolder }
);
export const tabGroupRailKey = (windowId: string, id: string): string => `tabGroup:${JSON.stringify([windowId, id])}`;
export function unifiedRailItems(catalog: ProjectCatalog, projects: RailProject[], groups: RailTabGroup[], windowId: string): RailItem[] {
  const placement = (key: string, order: number): RailPlacement =>
    catalog.railItems?.[key] ?? { folderId: null, pinned: false, order, pinnedOrder: order };
  return [
    ...groups.map((group, index): RailItem => ({ kind: 'tabGroup', group, key: tabGroupRailKey(windowId, group.id), name: group.name,
      ...placement(tabGroupRailKey(windowId, group.id), -3000 + index) })),
    ...Object.values(catalog.documents ?? {}).sort((a,b) => (a.kind === b.kind ? 0 : a.kind === 'tasks' ? -1 : 1) || a.order-b.order || a.id.localeCompare(b.id))
      .map((document, index): RailItem => ({ kind: document.kind, document, key: `document:${document.id}`, name: document.name,
        ...placement(`document:${document.id}`, -2000 + index) })),
    ...projects.map((project): RailItem => ({ kind: 'workspace', project, key: `workspace:${project.id}`, name: project.name,
      folderId: project.folderId, pinned: project.pinned, order: project.order, pinnedOrder: project.pinnedOrder })),
    ...Object.values(catalog.folders).map((folder): RailItem => ({ kind: 'folder', folder, key: `folder:${folder.id}`, name: folder.name,
      ...placement(`folder:${folder.id}`, 1000 + folder.order), folderId: null, pinned: false })),
  ];
}
export function sortRailItems(items: RailItem[], pinned = false): RailItem[] {
  return [...items].sort((a,b) => (pinned ? a.pinnedOrder-b.pinnedOrder : a.order-b.order) || a.key.localeCompare(b.key));
}
export function railItemMatches(item: RailItem, query: string): boolean {
  const text = query.trim().toLocaleLowerCase();
  return !text || item.name.toLocaleLowerCase().includes(text) ||
    (item.kind === 'workspace' && item.project.rootPath.toLocaleLowerCase().includes(text));
}
/** A pin never overwrites the remembered folder position. */
export function railPlacement(item: RailItem): RailPlacement {
  return { folderId: item.folderId, pinned: item.pinned, order: item.order, pinnedOrder: item.pinnedOrder };
}
