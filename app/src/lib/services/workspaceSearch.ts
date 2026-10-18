import { fuzzyRank } from '../picker/fuzzyRank';

export interface SearchableWorkspace { name: string; rootPath: string; lastUsedAt?: string }
/** Catalog-only matching shared by the rail, Manager and switcher. */
export function workspaceMatchesQuery(project: SearchableWorkspace, query: string): boolean {
  return !query.trim() || fuzzyRank([{ item: project, text: project.name, altTexts: [project.rootPath] }], query).length > 0;
}
/** Relevance always wins over recency; empty searches show recent projects first. */
export function rankWorkspaceProjects<T extends SearchableWorkspace>(projects: readonly T[], query: string): T[] {
  const recent = (project: T) => Date.parse(project.lastUsedAt ?? '') || 0;
  const ordered = [...projects].sort((a, b) => recent(b) - recent(a) || a.name.localeCompare(b.name) || a.rootPath.localeCompare(b.rootPath));
  return fuzzyRank(ordered.map(item => ({ item, text: item.name, altTexts: [item.rootPath] })), query).map(match => match.item);
}
