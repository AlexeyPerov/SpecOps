import { describe, expect, it } from 'vitest';
import { railItemMatches, railPlacement, sortRailItems, tabGroupRailKey, unifiedRailItems } from './unifiedRail';
import { catalogProjectForRoot } from './workspaceCatalog';
import type { ProjectCatalog } from '../domain/projectCatalog';

const group = { id: 'tabs-default' as const, name: 'Tabs', tabCount: 0, recentTabs: [] };
const catalog = (): ProjectCatalog => ({ version: 1, revision: 0, projects: {}, folders: {}, savedContexts: {}, documents: {
  plan: { id: 'plan', kind: 'tasks', name: 'Release plan', order: 0 },
  notes: { id: 'notes', kind: 'notes', name: 'Ideas', order: 0 },
}, railItems: {} });
describe('unified sidebar model', () => {
  it('mixes all four types with folders and respects common order', () => {
    const c = catalog(); c.folders.team = { id: 'team', name: 'Team', order: 0 };
    c.railItems = { 'document:plan': { folderId: null, pinned: false, order: -1, pinnedOrder: 0 } };
    const project = catalogProjectForRoot('/app');
    const rows = unifiedRailItems(c, [project], [group], 'main');
    expect(sortRailItems(rows).map(row => row.kind)).toEqual(['tabGroup', 'notes', 'tasks', 'workspace', 'folder']);
    expect(railItemMatches(rows.find(row => row.kind === 'workspace')!, '/APP')).toBe(true);
    expect(railItemMatches(rows.find(row => row.kind === 'tasks')!, 'release')).toBe(true);
  });
  it('scopes group placement to its window and preserves the folder position when pinned', () => {
    const c = catalog(); const key = tabGroupRailKey('main', group.id);
    c.railItems = { [key]: { folderId: 'team', pinned: true, order: 4, pinnedOrder: 2 } };
    const main = unifiedRailItems(c, [], [group], 'main').find(row => row.kind === 'tabGroup')!;
    const other = unifiedRailItems(c, [], [group], 'other').find(row => row.kind === 'tabGroup')!;
    expect(railPlacement(main)).toEqual({ folderId: 'team', pinned: true, order: 4, pinnedOrder: 2 });
    expect(other.pinned).toBe(false); expect(other.folderId).toBeNull();
    expect(tabGroupRailKey('a:b', 'c')).not.toBe(tabGroupRailKey('a', 'b:c'));
  });
  it('uses canonical workspace fields so manager changes are reflected immediately', () => {
    const c = catalog(); const project = { ...catalogProjectForRoot('/app'), folderId: 'team', pinned: true, order: 8, pinnedOrder: 3 };
    c.railItems = { 'workspace:/app': { folderId: null, pinned: false, order: 0, pinnedOrder: 0 } };
    expect(railPlacement(unifiedRailItems(c, [project], [], 'main').find(row => row.kind === 'workspace')!)).toEqual({ folderId: 'team', pinned: true, order: 8, pinnedOrder: 3 });
  });
});
