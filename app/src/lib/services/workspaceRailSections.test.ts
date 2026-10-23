import { beforeEach, describe, expect, it } from 'vitest';
import { workspaceRailSections, readRailWindowPreferences, writeRailWindowPreferences } from './workspaceRailSections';
import { catalogProjectForRoot } from './workspaceCatalog';
import type { ProjectCatalog } from '../domain/projectCatalog';
const project = (root: string, patch = {}) => ({ ...catalogProjectForRoot(root), ...patch });
const catalog = (): ProjectCatalog => ({ version:1, revision:1, folders:{ one:{id:'one',name:'One',order:0}, two:{id:'two',name:'Two',order:1} }, savedContexts:{}, documents:{}, projects: {
  '/a':project('/a',{folderId:'one',pinned:true,pinnedOrder:1}), '/b':project('/b',{folderId:'one',order:1}),
  '/hidden':project('/hidden',{pinned:true,hiddenFromRail:true}), '/other':project('/other'), '/closed':project('/closed'),
} });
beforeEach(() => localStorage.clear());
describe('workspace rail sections', () => {
  it('pins once, retains membership, counts actual visible entries, and excludes other windows', () => {
    const source=catalog(); const result=workspaceRailSections(source,[],{'/other':'other'},'main');
    expect(result.map(s=>[s.id,s.projects.map(p=>p.id)])).toEqual([
      ['pinned',['/a']],['folder:one',['/b']],['folder:two',[]],['unfiled',['/closed']],
    ]);
    expect(source.projects['/a'].folderId).toBe('one');
    expect(result.flatMap(s=>s.projects).every(p=>p.contextId===undefined)).toBe(true);
  });
  it('filters names and paths without altering stored order or group membership', () => {
    const source=catalog(); source.projects['/b'].name='Needle';
    expect(workspaceRailSections(source,[],{},'main','NEEDLE').flatMap(s=>s.projects).map(p=>p.id)).toEqual(['/b']);
    expect(workspaceRailSections(source,[],{},'main','closed').flatMap(s=>s.projects).map(p=>p.id)).toEqual(['/closed']);
    expect(workspaceRailSections(source,[],{},'main').flatMap(s=>s.projects).map(p=>p.id)).toContain('/a');
  });
  it('persists scroll/collapse independently per window and tolerates invalid optional UI data', () => {
    writeRailWindowPreferences('one',{collapsed:['folder:one'],scrollTop:420});
    writeRailWindowPreferences('two',{collapsed:['pinned'],scrollTop:12});
    expect(readRailWindowPreferences('one')).toEqual({collapsed:['folder:one'],scrollTop:420});
    expect(readRailWindowPreferences('two')).toEqual({collapsed:['pinned'],scrollTop:12});
    localStorage.setItem('spec-ops:workspace-rail:one','{');
    expect(readRailWindowPreferences('one')).toEqual({collapsed:[],scrollTop:0});
  });
});
