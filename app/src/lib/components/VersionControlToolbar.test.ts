import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { writable, fromStore } from 'svelte/store';
import VersionControlView, { clearVersionControlProbeCache } from './VersionControlView.svelte';
import { mountComponent } from './_testComponentMount';
import * as git from '../git/gitService';
import { prepareWorkspaceForGitOperation } from '../services/preGitOperationGuard';
vi.mock('../git/gitService', async original => ({ ...await original<typeof import('../git/gitService')>(), queryBranches: vi.fn().mockResolvedValue([]), queryTags: vi.fn().mockResolvedValue([]), queryStashes: vi.fn().mockResolvedValue([]), queryCommits: vi.fn().mockResolvedValue([]), queryCurrentBranch: vi.fn().mockResolvedValue({name:'main',isDetached:false,upstream:null}), queryWorkingTreeStatus: vi.fn(), queryWorkingTreeFileDiff: vi.fn().mockResolvedValue({hunks:[],isBinary:false}), fetchRemote:vi.fn(), pullRemote:vi.fn(), pushRemote:vi.fn(), isWorkingTreeDirty:vi.fn().mockResolvedValue(false), stageAll:vi.fn(), createCommit:vi.fn(), cancelGitCommand:vi.fn().mockResolvedValue({outcome:'cancelled'}) }));
vi.mock('../git/gitNavigationTree', async original => ({ ...await original<typeof import('../git/gitNavigationTree')>(), queryRemoteTrackingRefs:vi.fn().mockResolvedValue([]) }));
vi.mock('../git/versionControlProbe', async original => ({ ...await original<typeof import('../git/versionControlProbe')>(), probeVersionControlContext:vi.fn(async (root:string)=>({kind:'ready',repoRoot:root,isBareRepository:false})) }));
vi.mock('../git/versionControlRemotesCache',()=>({loadRemotes:vi.fn().mockResolvedValue([{name:'origin',fetchUrl:'https://example.test/repo',pushUrl:null}])}));
vi.mock('../git/versionControlRemoteSelection',async original=>({...await original<typeof import('../git/versionControlRemoteSelection')>(),readPersistedRemoteSelection:vi.fn().mockResolvedValue({remoteName:'origin',remoteBranch:null})}));
vi.mock('../services/preGitOperationGuard',()=>({prepareWorkspaceForGitOperation:vi.fn().mockResolvedValue(true)}));
async function settle(){for(let i=0;i<35;i++){await Promise.resolve();flushSync();}}
function button(host:HTMLElement,label:string){return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()===label)!;}
beforeEach(()=>{clearVersionControlProbeCache();vi.clearAllMocks();vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});vi.mocked(git.queryWorkingTreeStatus).mockResolvedValue({staged:[],unstaged:[{path:'file.ts',statusCode:' M'}]} as never);vi.mocked(prepareWorkspaceForGitOperation).mockResolvedValue(true);});
describe('mounted version control toolbar',()=>{
 it('opens Changes with focus and preserves draft and diff selection across History navigation',async()=>{
 const view=mountComponent(VersionControlView,{workspaceRootPath:'/repo'});await settle();button(view.host,'Commit').click();await settle();
 const input=view.host.querySelector<HTMLTextAreaElement>('textarea')!;expect(document.activeElement).toBe(input);input.value='Draft message';input.dispatchEvent(new Event('input',{bubbles:true}));flushSync();
 const row=view.host.querySelector<HTMLElement>('.git-changes-row')!;row.click();await settle();expect(git.queryWorkingTreeFileDiff).toHaveBeenCalledWith('/repo','file.ts','unstaged');
 const history=Array.from(view.host.querySelectorAll<HTMLElement>('[role=treeitem]')).find(n=>n.querySelector('.label')?.textContent==='History')!;history.click();await settle();button(view.host,'Commit').click();await settle();expect(view.host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Draft message');expect(row.closest('li')!.className).toContain('active');expect(git.pullRemote).not.toHaveBeenCalled();
 });
 it('requires confirmation, excludes duplicate launches, cancels and refreshes after failure',async()=>{
 const view=mountComponent(VersionControlView,{workspaceRootPath:'/repo'});await settle();button(view.host,'Pull').click();await settle();expect(view.host.querySelector('[role=dialog]')).not.toBeNull();expect(git.pullRemote).not.toHaveBeenCalled();button(view.host,'Cancel').click();await settle();
 let reject!:(error:Error)=>void;vi.mocked(git.fetchRemote).mockImplementationOnce(()=>new Promise((_,r)=>reject=r));const reads=vi.mocked(git.queryCurrentBranch).mock.calls.length;button(view.host,'Fetch').click();await settle();expect(button(view.host,'Push').disabled).toBe(true);button(view.host,'Cancel').click();await settle();expect(git.cancelGitCommand).toHaveBeenCalledTimes(1);reject(new Error('network unavailable'));await settle();expect(vi.mocked(git.queryCurrentBranch).mock.calls.length).toBeGreaterThan(reads);expect(git.fetchRemote).toHaveBeenCalledTimes(1);
 });
 it('aborts Pull after a pending save guard when workspace changes',async()=>{
 let resolve!:(value:boolean)=>void;vi.mocked(prepareWorkspaceForGitOperation).mockImplementationOnce(()=>new Promise(r=>resolve=r));const root=writable('/repo'), state=fromStore(root);const view=mountComponent(VersionControlView,{get workspaceRootPath(){return state.current;}});await settle();button(view.host,'Pull').click();await settle();button(view.host,'Confirm Pull').click();await settle();root.set('/other');await settle();resolve(true);await settle();expect(git.pullRemote).not.toHaveBeenCalled();expect(git.isWorkingTreeDirty).not.toHaveBeenCalled();
 });
 it('blocks stage on a rejected save guard and commits staged files once',async()=>{
 const view=mountComponent(VersionControlView,{workspaceRootPath:'/repo'});await settle();button(view.host,'Commit').click();await settle();vi.mocked(prepareWorkspaceForGitOperation).mockResolvedValueOnce(false);button(view.host,'Stage all').click();await settle();expect(git.stageAll).not.toHaveBeenCalled();
 vi.mocked(git.queryWorkingTreeStatus).mockResolvedValue({staged:[{path:'file.ts',statusCode:'M '}],unstaged:[]} as never);button(view.host,'Stage all').click();await settle();expect(git.stageAll).toHaveBeenCalledWith('/repo');const input=view.host.querySelector<HTMLTextAreaElement>('textarea')!;input.value='Save staged changes';input.dispatchEvent(new Event('input',{bubbles:true}));flushSync();const commit=view.host.querySelector<HTMLButtonElement>('.git-changes-commit-button')!;commit.click();commit.click();await settle();expect(git.createCommit).toHaveBeenCalledTimes(1);expect(git.createCommit).toHaveBeenCalledWith('/repo','Save staged changes',expect.objectContaining({commandId:expect.any(String)}));expect(input.value).toBe('');
 });
 it('exposes keyboard overflow and explains unavailable Merge',async()=>{
 const view=mountComponent(VersionControlView,{workspaceRootPath:'/repo'});await settle();expect(button(view.host,'Merge').disabled).toBe(true);expect(button(view.host,'Merge').title).toContain('not yet');const more=view.host.querySelector<HTMLButtonElement>('[aria-label="More version control actions"]')!;more.click();await settle();window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',cancelable:true}));expect(document.activeElement?.textContent).toContain('Branch');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));await settle();expect(more.getAttribute('aria-expanded')).toBe('false');expect(document.activeElement).toBe(more);
 });
});
