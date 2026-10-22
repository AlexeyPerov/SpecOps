import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { writable } from 'svelte/store';
import ActivityRail from './ActivityRail.svelte';
import { mountComponent } from './_testComponentMount';
import { createSinglePaneLayout, type WorkspaceEntry } from '../domain/contracts';
import { _resetProjectCatalogForTests, catalogProjectForRoot, loadProjectCatalog } from '../services/workspaceCatalog';
import { invoke } from '@tauri-apps/api/core';
import { refreshWorkspaceGitSummaries } from '../git/workspaceGitSummary';
import type { WorkspaceGitSummaryDemand, WorkspaceGitSummarySnapshot } from '../git/workspaceGitSummary';
const fixtures = vi.hoisted(() => ({ consumers: [] as { path: string; listener: (snapshot: WorkspaceGitSummarySnapshot) => void; demand: WorkspaceGitSummaryDemand; released: boolean }[] }));
vi.mock('../git/workspaceGitSummary', () => ({
  subscribeWorkspaceGitSummary: vi.fn((path, listener, demand) => {
    const consumer = { path, listener, demand, released: false }; fixtures.consumers.push(consumer);
    listener({status:'unknown',refreshing:false,summary:null,checkedAt:null,error:null});
    return { setDemand(next: WorkspaceGitSummaryDemand) { consumer.demand = next; }, unsubscribe() { consumer.released = true; }, refresh: vi.fn() };
  }), refreshWorkspaceGitSummaries: vi.fn(async () => {}),
}));
vi.mock('../state/chatStore', () => ({ chatSessionCountsByRoot: writable(new Map()) }));
vi.mock('../services/workspaceWindowPlacement', () => ({ readLiveWorkspaceWindowOwners: vi.fn(async () => ({})), WORKSPACE_PLACEMENT_CHANGED: 'fixture:placement' }));
vi.mock('../services/addWorkspaceToWindow', () => ({ addWorkspaceToWindow: vi.fn(async () => null) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
class Observer {
  static all: Observer[] = [];
  node!: HTMLElement;
  constructor(readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) { Observer.all.push(this); }
  observe(node: HTMLElement) { this.node = node; }
  disconnect() {}
  visible(visible: boolean) { this.callback([{ target: this.node, isIntersecting: visible } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}
vi.stubGlobal('IntersectionObserver', Observer);
const workspace = (i: number): WorkspaceEntry => ({ id: `ws-${i}`, rootPath: `/projects/${i}`, snapshot: { documents: [], session: { editorLayout: createSinglePaneLayout([], null), lastActiveWindowId:'main', windowBounds:null, lastActiveSessionId:null } } });
const demanded = () => fixtures.consumers.filter(consumer => !consumer.released && consumer.demand.enabled !== false);
const emit = (path: string, snapshot: WorkspaceGitSummarySnapshot) => fixtures.consumers.filter(c => !c.released && c.path === path).forEach(c => c.listener(snapshot));
const summary = { branchName: 'topic', isDetached: false, isUnborn: false, isDirty: true, hasConflicts: true, aheadBehind: { ahead: 2, behind: 1 } };
beforeEach(() => { fixtures.consumers = []; Observer.all = []; vi.clearAllMocks(); _resetProjectCatalogForTests(); localStorage.clear(); vi.mocked(invoke).mockResolvedValue({version:1,revision:1,projects:{},folders:{},savedContexts:{}}); });
describe('rail Git demand and presentation', () => {
  it('cold 30-project rail demands only active and intersecting roots, releasing rows on collapse', async () => {
    const {host,unmount} = mountComponent(ActivityRail, {workspaces:Array.from({length:30},(_,i)=>workspace(i)),activeContextId:'ws-29' as const,panelWidthPx:240}); await tick();
    expect(demanded().map(c=>[c.path,c.demand.priority])).toEqual([['/projects/29','active']]);
    expect(Observer.all).toHaveLength(30);expect(Observer.all[0].options?.root).toBe(host.querySelector('.rail-workspaces'));
    Observer.all[0].visible(true); Observer.all[1].visible(true); await tick();expect(demanded()).toHaveLength(3);
    Observer.all[0].visible(false); await tick(); expect(demanded()).toHaveLength(2);
    host.querySelector('[data-workspace-id]')!.closest('section')!.querySelector<HTMLButtonElement>('.rail-section-toggle')!.click(); await tick();
    expect(demanded().map(c=>c.path)).toEqual(['/projects/29']);
    unmount(); await tick(); expect(demanded()).toHaveLength(0);
  });
  it('keeps hidden active demand through filtering and resizes without explicit refresh or subscription churn', async () => {
    vi.mocked(invoke).mockResolvedValue({version:1,revision:1,projects:{'/projects/29':{...catalogProjectForRoot('/projects/29'),hiddenFromRail:true}},folders:{},savedContexts:{}}); await loadProjectCatalog();
    const {host}=mountComponent(ActivityRail,{workspaces:[workspace(0),workspace(1),workspace(29)],activeContextId:'ws-29' as const,panelWidthPx:240}); await tick();
    expect(Observer.all).toHaveLength(2); Observer.all[0].visible(true); await tick();const count=fixtures.consumers.length;
    host.querySelector('[role=slider]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})); await tick();
    expect(fixtures.consumers).toHaveLength(count); expect(refreshWorkspaceGitSummaries).not.toHaveBeenCalled();
    host.querySelector('[role=slider]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})); await tick();
    const search=host.querySelector<HTMLInputElement>('.rail-search')!;search.value='projects/1';search.dispatchEvent(new Event('input',{bubbles:true}));await tick();
    expect(demanded().map(c=>c.path)).toEqual(['/projects/29']);expect(refreshWorkspaceGitSummaries).not.toHaveBeenCalled();
  });
  it('releases every removed row consumer across repeated filtering cycles', async () => {
    const {host,unmount}=mountComponent(ActivityRail,{workspaces:Array.from({length:12},(_,i)=>workspace(i)),panelWidthPx:240});await tick();
    const search=host.querySelector<HTMLInputElement>('.rail-search')!;
    for(let index=0;index<12;index++) {
      search.value=`projects/${index}`;search.dispatchEvent(new Event('input',{bubbles:true}));await tick();
      const retained=Observer.all.filter(observer=>host.contains(observer.node));
      retained.forEach(observer=>observer.visible(true));await tick();
      expect(demanded().length).toBeLessThanOrEqual(host.querySelectorAll('[data-workspace-id]').length);
      search.value='no-matching-project';search.dispatchEvent(new Event('input',{bubbles:true}));await tick();expect(demanded()).toHaveLength(0);
      retained.forEach(observer=>observer.visible(true));await tick();expect(demanded()).toHaveLength(0);
    }
    unmount();await tick();expect(fixtures.consumers.every(consumer=>consumer.released)).toBe(true);
  });
  it.each([48,240])('retains branch/conflict/tracking/error meaning at width %i; separate VC/refresh never select row',async(width)=>{
    const select=vi.fn(),vc=vi.fn();const {host}=mountComponent(ActivityRail,{workspaces:[workspace(1),workspace(2)],panelWidthPx:width,onSelectContext:select,onOpenVersionControl:vc});await tick();
    Observer.all[0].visible(true);await tick();
    expect(host.querySelector('.rail-workspace-git, .rail-workspace-git-mark')).toBeNull();
    const fresh: WorkspaceGitSummarySnapshot={status:'fresh',refreshing:false,summary,checkedAt:123,error:null};emit('/projects/1',fresh);await tick();
    const row=host.querySelector<HTMLElement>('[data-workspace-id]')!;
    expect(row.getAttribute('aria-label')).toContain('topic · ↑2 ↓1 · conflicts');expect(row.getAttribute('aria-label')).toContain('locally known upstream');expect(host.querySelector('.rail-git-conflict')).not.toBeNull();
    const visibleGit=()=>row.querySelector('.rail-workspace-git, .rail-workspace-git-mark')?.textContent;
    const initialGit=visibleGit();
    emit('/projects/1',{...fresh,status:'stale',refreshing:true});await tick();expect(visibleGit()).toBe(initialGit);expect(row.getAttribute('aria-label')).toContain('Stale');expect(row.getAttribute('aria-label')).toContain('previous result retained');
    emit('/projects/1',{...fresh,status:'error',error:'timeout'});await tick();expect(row.getAttribute('aria-label')).toContain('topic');expect(row.getAttribute('aria-label')).toContain('timeout');expect(visibleGit()).toBe(initialGit);
    host.querySelector<HTMLButtonElement>('.rail-git-action')!.click();expect(vc).toHaveBeenCalledWith('ws-1');expect(select).not.toHaveBeenCalled();
    host.querySelector<HTMLButtonElement>('[aria-label="Refresh visible Git summaries"]')!.click();await tick();expect(refreshWorkspaceGitSummaries).toHaveBeenCalledWith(['/projects/1']);
    row.dispatchEvent(new KeyboardEvent('keydown',{key:'ContextMenu',bubbles:true}));await tick();
    [...document.querySelectorAll<HTMLButtonElement>('[role=menu] button')].find(button=>button.textContent==='Refresh Git status')!.click();await tick();
    expect(refreshWorkspaceGitSummaries).toHaveBeenLastCalledWith(['/projects/1']);expect(select).not.toHaveBeenCalled();
  });
});
