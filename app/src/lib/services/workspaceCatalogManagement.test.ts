import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCatalogBatch, managerProjects, removeClosedCatalogProject, sortManagerProjects } from './workspaceCatalogManagement';
import { catalogProjectForRoot, getProjectCatalog, updateProjectCatalog } from './workspaceCatalog';
import { readLiveWorkspaceWindowOwners } from './workspaceWindowPlacement';
import { appState } from '../state/appState';
vi.mock('./workspaceCatalog', async original => ({ ...await original<typeof import('./workspaceCatalog')>(), getProjectCatalog:vi.fn(), updateProjectCatalog:vi.fn().mockResolvedValue(undefined) }));
vi.mock('./workspaceWindowPlacement', () => ({ readLiveWorkspaceWindowOwners:vi.fn().mockResolvedValue({}) }));
const catalog = () => ({ version:1 as const,revision:1,projects:{'/a':{...catalogProjectForRoot('/a'),pinned:true},'/b':{...catalogProjectForRoot('/b'),name:'Alpha',lastUsedAt:'2026-10-18'}},folders:{},savedContexts:{}, documents:{} });
beforeEach(() => { vi.clearAllMocks(); appState.resetAppState(); vi.mocked(getProjectCatalog).mockReturnValue(catalog()); vi.mocked(updateProjectCatalog).mockResolvedValue(undefined as never); vi.mocked(readLiveWorkspaceWindowOwners).mockResolvedValue({}); });
describe('catalog management', () => {
  it('distinguishes ownership and sorts the entire catalog without opening contexts', () => {
    const rows = managerProjects(catalog(), [], {'/a':'other'});
    expect(rows.map(row=>row.openState)).toEqual(['other','closed']);
    expect(sortManagerProjects(rows,'name').map(row=>row.id)).toEqual(['/a','/b']);
    expect(sortManagerProjects(rows,'recent')[0].id).toBe('/b');
    expect(sortManagerProjects(rows,'manual')[0].id).toBe('/a');
    const grouped=rows.map((row,index)=>({...row,pinned:false,folderId:index ? 'first':'second',order:index ? 9:0}));
    expect(sortManagerProjects(grouped,'manual',{first:{id:'first',name:'First',order:0},second:{id:'second',name:'Second',order:1}})[0].id).toBe('/b');
  });
  it('applies semantic folder assignment atomically and reports stale selections individually', async () => {
    const result = await applyCatalogBatch(['/a','/b','/gone'],{type:'folder',folderId:null});
    expect(updateProjectCatalog).toHaveBeenCalledExactlyOnceWith([{type:'moveProject',id:'/a',folderId:null,pinned:false},{type:'moveProject',id:'/b',folderId:null,pinned:false}]);
    expect(result.succeeded).toEqual(['/a','/b']); expect(result.errors[0].id).toBe('/gone');
  });
  it('does not report success when the native transaction fails', async () => {
    vi.mocked(updateProjectCatalog).mockRejectedValueOnce(new Error('disk full'));
    const result = await applyCatalogBatch(['/a','/b'],{type:'pin',value:false});
    expect(result.succeeded).toEqual([]); expect(result.errors).toHaveLength(2);
  });
  it('rejects removal of local and remote open projects', async () => {
    appState.addWorkspace('/a'); await expect(removeClosedCatalogProject('/a')).rejects.toThrow('Close the workspace');
    vi.mocked(readLiveWorkspaceWindowOwners).mockResolvedValue({'/b':'other'});
    await expect(removeClosedCatalogProject('/b')).rejects.toThrow('owning window');
    expect(updateProjectCatalog).not.toHaveBeenCalled();
  });
});
