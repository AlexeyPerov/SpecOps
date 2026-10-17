import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { writable, fromStore } from 'svelte/store';
import VersionControlView, { clearVersionControlProbeCache } from './VersionControlView.svelte';
import { mountComponent } from './_testComponentMount';
import * as git from '../git/gitService';
import * as pushState from '../git/gitPush';
import * as pullState from '../git/gitPull';
import { promptLocalChangesPull } from '../services/localChangesPullPrompt';
import { prepareWorkspaceForGitOperation } from '../services/preGitOperationGuard';
vi.mock('../git/gitService', async original => ({ ...await original<typeof import('../git/gitService')>(), queryRemoteHeads:vi.fn().mockResolvedValue(['main']), queryBranches: vi.fn().mockResolvedValue([]), queryTags: vi.fn().mockResolvedValue([]), queryStashes: vi.fn().mockResolvedValue([]), queryCommits: vi.fn().mockResolvedValue([]), queryCurrentBranch: vi.fn().mockResolvedValue({name:'main',isDetached:false,upstream:null}), queryWorkingTreeStatus: vi.fn(), queryWorkingTreeFileDiff: vi.fn().mockResolvedValue({hunks:[],isBinary:false}), createStash:vi.fn().mockResolvedValue("stash-sha"), applyStash:vi.fn().mockResolvedValue(undefined), fetchRemote:vi.fn(), pullRemote:vi.fn(), pushRemote:vi.fn(), isWorkingTreeDirty:vi.fn().mockResolvedValue(false), stageAll:vi.fn(), createCommit:vi.fn(), cancelGitCommand:vi.fn().mockResolvedValue({outcome:'cancelled'}) }));
vi.mock('../git/gitPull', async original => ({ ...await original<typeof import('../git/gitPull')>(), queryPullSnapshot:vi.fn().mockResolvedValue({head:'abc',branch:'main'}), assertPullSnapshot:vi.fn().mockResolvedValue(undefined), queryGitOperationState:vi.fn().mockResolvedValue({kind:'none',conflicts:[]}), recoverGitOperation:vi.fn().mockResolvedValue(undefined) }));
vi.mock('../git/gitPush',async original=>({...await original<typeof import('../git/gitPush')>(),queryPushSources:vi.fn().mockResolvedValue({branches:[{ref:'refs/heads/main',name:'main',sha:'a'.repeat(40),current:true,upstream:'',upstreamRemote:'',upstreamBranch:''}],tags:[]}),executePushPlan:vi.fn()}));
vi.mock('../git/gitNavigationTree', async original => ({ ...await original<typeof import('../git/gitNavigationTree')>(), queryRemoteTrackingRefs:vi.fn().mockResolvedValue([]) }));
vi.mock('../git/versionControlProbe', async original => ({ ...await original<typeof import('../git/versionControlProbe')>(), probeVersionControlContext:vi.fn(async (root:string)=>({kind:'ready',repoRoot:root,isBareRepository:false})) }));
vi.mock('../git/versionControlRemotesCache',()=>({loadRemotes:vi.fn().mockResolvedValue([{name:'origin',fetchUrl:'https://example.test/repo',pushUrl:null}])}));
vi.mock('../git/versionControlRemoteSelection',async original=>({...await original<typeof import('../git/versionControlRemoteSelection')>(),readPersistedRemoteSelection:vi.fn().mockResolvedValue({remoteName:'origin',remoteBranch:null})}));
vi.mock('../services/localChangesPullPrompt',()=>({promptLocalChangesPull:vi.fn().mockResolvedValue({type:'stash-and-pull'})}));
vi.mock('../services/preGitOperationGuard',()=>({prepareWorkspaceForGitOperation:vi.fn().mockResolvedValue(true)}));
async function settle(){for(let i=0;i<35;i++){await Promise.resolve();flushSync();}}
function button(host:HTMLElement,label:string){return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()===label)!;}
beforeEach(()=>{vi.mocked(pushState.executePushPlan).mockResolvedValue({ok:true,refs:[{destination:'refs/heads/main',status:'success',summary:'new branch'}],message:'',cancelled:false});clearVersionControlProbeCache();vi.clearAllMocks();vi.mocked(pullState.queryGitOperationState).mockResolvedValue({kind:"none",conflicts:[]});vi.mocked(pullState.assertPullSnapshot).mockResolvedValue(undefined);vi.mocked(git.isWorkingTreeDirty).mockResolvedValue(false);vi.mocked(git.pullRemote).mockResolvedValue(undefined);vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});vi.mocked(git.queryWorkingTreeStatus).mockResolvedValue({staged:[],unstaged:[{path:'file.ts',statusCode:' M'}]} as never);vi.mocked(prepareWorkspaceForGitOperation).mockResolvedValue(true);});
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
 let resolve!:(value:boolean)=>void;vi.mocked(prepareWorkspaceForGitOperation).mockImplementationOnce(()=>new Promise(r=>resolve=r));const root=writable('/repo'), state=fromStore(root);const view=mountComponent(VersionControlView,{get workspaceRootPath(){return state.current;}});await settle();button(view.host,'Pull').click();await settle();view.host.querySelector<HTMLButtonElement>('[role=dialog] .btn-primary')!.click();await settle();root.set('/other');await settle();resolve(true);await settle();expect(git.pullRemote).not.toHaveBeenCalled();expect(git.isWorkingTreeDirty).not.toHaveBeenCalled();
 });
 it('blocks stage on a rejected save guard and commits staged files once',async()=>{
 const view=mountComponent(VersionControlView,{workspaceRootPath:'/repo'});await settle();button(view.host,'Commit').click();await settle();vi.mocked(prepareWorkspaceForGitOperation).mockResolvedValueOnce(false);button(view.host,'Stage all').click();await settle();expect(git.stageAll).not.toHaveBeenCalled();
 vi.mocked(git.queryWorkingTreeStatus).mockResolvedValue({staged:[{path:'file.ts',statusCode:'M '}],unstaged:[]} as never);button(view.host,'Stage all').click();await settle();expect(git.stageAll).toHaveBeenCalledWith('/repo');const input=view.host.querySelector<HTMLTextAreaElement>('textarea')!;input.value='Save staged changes';input.dispatchEvent(new Event('input',{bubbles:true}));flushSync();const commit=view.host.querySelector<HTMLButtonElement>('.git-changes-commit-button')!;commit.click();commit.click();await settle();expect(git.createCommit).toHaveBeenCalledTimes(1);expect(git.createCommit).toHaveBeenCalledWith('/repo','Save staged changes',expect.objectContaining({commandId:expect.any(String)}));expect(input.value).toBe('');
 });
 it('exposes keyboard overflow and explains unavailable Merge',async()=>{
 const view=mountComponent(VersionControlView,{workspaceRootPath:'/repo'});await settle();expect(button(view.host,'Merge').disabled).toBe(true);expect(button(view.host,'Merge').title).toContain('not yet');const more=view.host.querySelector<HTMLButtonElement>('[aria-label="More version control actions"]')!;more.click();await settle();window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',cancelable:true}));expect(document.activeElement?.textContent).toContain('Branch');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));await settle();expect(more.getAttribute('aria-expanded')).toBe('false');expect(document.activeElement).toBe(more);
 });
 it('rejects changed HEAD at submission and retains the modal with an actionable error',async()=>{
 const view=mountComponent(VersionControlView,{workspaceRootPath:'/repo'});await settle();button(view.host,'Pull').focus();button(view.host,'Pull').click();await settle();vi.mocked(pullState.assertPullSnapshot).mockRejectedValueOnce(new Error('HEAD or the target branch changed. Close and reopen Pull.'));view.host.querySelector<HTMLButtonElement>('[role=dialog] .btn-primary')!.click();await settle();expect(git.pullRemote).not.toHaveBeenCalled();expect(view.host.querySelector('[role=alert]')?.textContent).toContain('HEAD or the target branch changed');
 });
 it('keeps autostash safe during unfinished merge and continues through the save guard',async()=>{
 let state:pullState.GitOperationState={kind:'none',conflicts:[]};vi.mocked(pullState.queryGitOperationState).mockImplementation(async()=>state);vi.mocked(git.isWorkingTreeDirty).mockResolvedValue(true);vi.mocked(git.pullRemote).mockImplementationOnce(async()=>{state={kind:'merge',conflicts:[]};});const notify=vi.fn();const view=mountComponent(VersionControlView,{workspaceRootPath:'/repo',notify});await settle();const trigger=button(view.host,'Pull');trigger.focus();trigger.click();await settle();view.host.querySelector<HTMLButtonElement>('[role=dialog] .btn-primary')!.click();await settle();expect(git.createStash).toHaveBeenCalledOnce();expect(git.applyStash).not.toHaveBeenCalled();expect(notify).toHaveBeenCalledWith(expect.stringContaining('remain in the latest stash'));expect(view.host.querySelector('[role=dialog]')).toBeNull();expect(document.activeElement).toBe(trigger);expect(view.host.textContent).toContain('merge in progress');
 vi.mocked(prepareWorkspaceForGitOperation).mockResolvedValueOnce(false);button(view.host,'Continue operation').click();await settle();expect(pullState.recoverGitOperation).not.toHaveBeenCalled();
 vi.mocked(pullState.recoverGitOperation).mockImplementationOnce(async()=>{state={kind:'none',conflicts:[]};});button(view.host,'Continue operation').click();await settle();expect(pullState.recoverGitOperation).toHaveBeenCalledWith('/repo','merge','continue',expect.objectContaining({commandId:expect.any(String)}));expect(view.host.textContent).not.toContain('merge in progress');
 });
 it('recovers conflict state after failed Pull, disables Continue until staged, and aborts',async()=>{
 let state:pullState.GitOperationState={kind:'none',conflicts:[]};vi.mocked(pullState.queryGitOperationState).mockImplementation(async()=>state);vi.mocked(git.pullRemote).mockImplementationOnce(async()=>{state={kind:'rebase',conflicts:['file.ts']};throw new Error('conflict');});const view=mountComponent(VersionControlView,{workspaceRootPath:'/repo'});await settle();button(view.host,'Pull').click();await settle();view.host.querySelector<HTMLButtonElement>('[role=dialog] .btn-primary')!.click();await settle();expect(view.host.querySelector('[role=dialog]')).toBeNull();expect(button(view.host,'Continue operation').disabled).toBe(true);expect(view.host.textContent).toContain('rebase in progress');button(view.host,'Abort operation').click();await settle();expect(pullState.recoverGitOperation).toHaveBeenCalledWith('/repo','rebase','abort',expect.anything());
 });
 it('loads unfinished operations again after a view remount',async()=>{
 vi.mocked(pullState.queryGitOperationState).mockResolvedValue({kind:'merge',conflicts:[]});const view=mountComponent(VersionControlView,{workspaceRootPath:'/repo'});await settle();expect(view.host.textContent).toContain('merge in progress');view.unmount();await settle();const remount=mountComponent(VersionControlView,{workspaceRootPath:'/repo'});await settle();expect(button(remount.host,'Continue operation').disabled).toBe(false);expect(button(remount.host,'Abort operation').disabled).toBe(false);
 });

 it('publishes Pull cancellation only at process start and rereads state after cancellation',async()=>{
 let reject!:(error:Error)=>void;let start!:(id:string)=>void;let id='';vi.mocked(git.pullRemote).mockImplementationOnce(async(_root,_target,options)=>{start=options!.onStart!;id=options!.commandId!;await new Promise<void>((_resolve,r)=>reject=r);});const view=mountComponent(VersionControlView,{workspaceRootPath:'/repo'});await settle();button(view.host,'Pull').click();await settle();view.host.querySelector<HTMLButtonElement>('[role=dialog] .btn-primary')!.click();await settle();expect(button(view.host,'Cancel operation').disabled).toBe(true);start(id);await settle();expect(button(view.host,'Cancel operation').disabled).toBe(false);const reads=vi.mocked(pullState.queryGitOperationState).mock.calls.length;button(view.host,'Cancel operation').click();await settle();expect(git.cancelGitCommand).toHaveBeenCalledWith(id);reject(new git.GitCommandCancelledError());await settle();expect(vi.mocked(pullState.queryGitOperationState).mock.calls.length).toBeGreaterThan(reads);expect(view.host.querySelector('[role=dialog]')?.textContent).not.toContain('in progress');
 });

 it('submits an exact Push plan after save preflight, excludes duplicate launch and refreshes after partial failure',async()=>{
 const view=mountComponent(VersionControlView,{workspaceRootPath:'/repo'});await settle();const reads=vi.mocked(git.queryCurrentBranch).mock.calls.length;
 button(view.host,'Push').click();await settle();const push=view.host.querySelector<HTMLButtonElement>('[role=dialog] .btn-primary')!;
 let finish!:(result:pushState.PushResult)=>void;vi.mocked(pushState.executePushPlan).mockImplementationOnce(async(_root,_plan,options)=>{options!.onStart!(options!.commandId!);return new Promise(r=>finish=r);});push.click();push.click();await settle();expect(pushState.executePushPlan).toHaveBeenCalledOnce();expect(prepareWorkspaceForGitOperation).toHaveBeenCalled();expect(pushState.executePushPlan).toHaveBeenCalledWith('/repo',{remote:'origin',branches:[{ref:'refs/heads/main',sha:'a'.repeat(40),destination:'refs/heads/main',track:false}],tags:[]},expect.objectContaining({signal:expect.any(AbortSignal)}));
 button(view.host,'Cancel operation').click();await settle();expect(git.cancelGitCommand).toHaveBeenCalledOnce();expect(vi.mocked(pushState.executePushPlan).mock.calls[0][2]!.signal!.aborted).toBe(true);
 finish({ok:false,refs:[{destination:'refs/heads/main',status:'rejected',summary:'non-fast-forward'}],cancelled:false,message:'rejected'});await settle();expect(vi.mocked(git.queryCurrentBranch).mock.calls.length).toBeGreaterThan(reads);expect(view.host.querySelector('[role=dialog]')?.textContent).toContain('non-fast-forward');expect(push.disabled).toBe(true);
 });
 it('aborts Push after rejected preflight or a workspace change during preflight',async()=>{
 const root=writable('/repo'),state=fromStore(root);const view=mountComponent(VersionControlView,{get workspaceRootPath(){return state.current;}});await settle();button(view.host,'Push').click();await settle();vi.mocked(prepareWorkspaceForGitOperation).mockResolvedValueOnce(false);view.host.querySelector<HTMLButtonElement>('[role=dialog] .btn-primary')!.click();await settle();expect(pushState.executePushPlan).not.toHaveBeenCalled();
 let release!:(ok:boolean)=>void;vi.mocked(prepareWorkspaceForGitOperation).mockImplementationOnce(()=>new Promise(r=>release=r));view.host.querySelector<HTMLButtonElement>('[role=dialog] .btn-primary')!.click();await settle();root.set('/other');await settle();release(true);await settle();expect(pushState.executePushPlan).not.toHaveBeenCalled();
 });
 it('rejects a stale Push queued start before native spawn and refreshes after failure',async()=>{
 const root=writable('/repo'),state=fromStore(root);let start!:(id:string)=>void;let reject!:(error:Error)=>void;vi.mocked(pushState.executePushPlan).mockImplementationOnce(async(_r,_p,options)=>{start=options!.onStart!;return new Promise((_resolve,r)=>reject=r);});const view=mountComponent(VersionControlView,{get workspaceRootPath(){return state.current;}});await settle();button(view.host,'Push').click();await settle();view.host.querySelector<HTMLButtonElement>('[role=dialog] .btn-primary')!.click();await settle();expect(button(view.host,'Cancel operation').disabled).toBe(true);root.set('/other');await settle();expect(()=>start('native-id')).toThrow('Repository changed');reject(new Error('Repository changed'));await settle();
 });

});


it('auto-selects a ready scope and keeps metadata for commits without changed files', async () => {
 const main = { sha:'1'.repeat(40),parents:[],refs:[],subject:'Main history',authorName:'Test Author',authorEmail:'test@example.invalid',authorTime:1700000000,committerName:'Test Author',committerEmail:'test@example.invalid',committerTime:1700000000 };
 const branch = { ...main,sha:'2'.repeat(40),subject:'Branch history' };
 vi.mocked(git.queryCommits).mockImplementation(async (_root, options) => options?.filterMode === 'all-branches' ? [branch,main] : [main]);
 const detailSpy = vi.spyOn(git,'queryCommitDetail').mockImplementation(async (_root,sha) => ({ ...main,sha,message:sha === branch.sha ? 'Branch metadata survives empty files' : 'Main metadata',files:[] }));
 const view=mountComponent(VersionControlView,{workspaceRootPath:'/scope-repo'});await settle();
 expect(view.host.querySelector('[role=option][aria-selected=true]')?.getAttribute('data-sha')).toBe(main.sha);
 button(view.host,'All branches').click();await settle();
 expect(view.host.querySelector('[role=option][aria-selected=true]')?.getAttribute('data-sha')).toBe(branch.sha);
 expect(view.host.textContent).toContain('Branch metadata survives empty files');
 expect(view.host.textContent).not.toContain('Commit metadata unavailable');
 expect(detailSpy).toHaveBeenLastCalledWith('/scope-repo',branch.sha);
});

it('does not mount worktree Changes or query recovery state for bare repositories', async () => {
 const {probeVersionControlContext}=await import('../git/versionControlProbe');
 vi.mocked(probeVersionControlContext).mockResolvedValueOnce({kind:'ready',workspaceRootPath:'/bare.git',repoRoot:'/bare.git',isBareRepository:true});
 const view=mountComponent(VersionControlView,{workspaceRootPath:'/bare.git'});await settle();
 expect(view.host.textContent).toContain('This is a bare repository');
 expect(git.queryWorkingTreeStatus).not.toHaveBeenCalled();
 expect(pullState.queryGitOperationState).not.toHaveBeenCalled();
 expect(view.host.querySelector('[aria-label="Commit history"]')).not.toBeNull();
});

it('restores history selection, query depth and scroll on remount, isolated by workspace and window', async () => {
 const all=Array.from({length:1000},(_,i)=>({sha:(i+1).toString(16).padStart(40,'0'),parents:[],refs:[],subject:`History ${i}`,authorName:'Test Author',authorEmail:'test@example.invalid',authorTime:1700000000,committerName:'Test Author',committerEmail:'test@example.invalid',committerTime:1700000000}));
 vi.mocked(git.queryCommits).mockImplementation(async (_root,options)=>all.slice(options?.skip ?? 0,(options?.skip ?? 0)+(options?.limit ?? 500)));
 let view=mountComponent(VersionControlView,{workspaceRootPath:'/runtime-history',windowId:'first'});await settle();
 button(view.host,'Load more commits').click();await settle();
 view.host.querySelectorAll<HTMLButtonElement>('.git-history-row')[2]!.click();await settle();
 const {readGitWorkspaceViewState}=await import('../git/gitWorkspaceViewState');
 expect(readGitWorkspaceViewState('specops.git-layout:first:/runtime-history')?.view?.selected?.sha).toBe(all[2].sha);
 const scroll=view.host.querySelector<HTMLElement>('.git-history-scroll')!;scroll.scrollTop=72;scroll.dispatchEvent(new Event('scroll'));flushSync();
 view.unmount();await settle();
 const other=mountComponent(VersionControlView,{workspaceRootPath:'/runtime-history',windowId:'second'});await settle();
 expect(other.host.querySelector('[role=option][aria-selected=true]')?.getAttribute('data-sha')).toBe(all[0].sha);other.unmount();await settle();
 view=mountComponent(VersionControlView,{workspaceRootPath:'/runtime-history',windowId:'first'});await settle();
 expect(git.queryCommits).toHaveBeenLastCalledWith('/runtime-history',expect.objectContaining({limit:1000}));
 expect(view.host.querySelector('[role=option][aria-selected=true]')?.getAttribute('data-sha')).toBe(all[2].sha);
 expect(view.host.querySelector<HTMLElement>('.git-history-scroll')!.scrollTop).toBe(72);
});

it('preserves Changes draft and valid diff across remount without leaking to another workspace', async () => {
 const make=()=>mountComponent(VersionControlView,{workspaceRootPath:'/runtime-changes',windowId:'first'});
 let view=make();await settle();button(view.host,'Commit').click();await settle();
 const input=view.host.querySelector<HTMLTextAreaElement>('textarea')!;input.value='Keep this draft';input.dispatchEvent(new Event('input',{bubbles:true}));flushSync();
 view.host.querySelector<HTMLElement>('.git-changes-row')!.click();await settle();view.unmount();await settle();
 const other=mountComponent(VersionControlView,{workspaceRootPath:'/other-runtime',windowId:'first'});await settle();button(other.host,'Commit').click();await settle();expect(other.host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');other.unmount();await settle();
 view=make();await settle();expect(view.host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Keep this draft');
 expect(git.queryWorkingTreeFileDiff).toHaveBeenLastCalledWith('/runtime-changes','file.ts','unstaged');
 expect(view.host.querySelector('.git-changes-row')?.closest('li')?.classList.contains('git-changes-item-active')).toBe(true);
});

it('clears a committed cached draft when an in-flight commit finishes after unmount', async () => {
 vi.mocked(git.queryWorkingTreeStatus).mockResolvedValue({staged:[{path:'file.ts',statusCode:'M '}],unstaged:[]} as never);
 let finish!:()=>void;vi.mocked(git.createCommit).mockImplementationOnce(()=>new Promise<void>(resolve=>finish=resolve));
 const make=()=>mountComponent(VersionControlView,{workspaceRootPath:'/runtime-commit',windowId:'first'});
 let view=make();await settle();button(view.host,'Commit').click();await settle();
 const input=view.host.querySelector<HTMLTextAreaElement>('textarea')!;input.value='Commit once';input.dispatchEvent(new Event('input',{bubbles:true}));flushSync();
 view.host.querySelector<HTMLButtonElement>('.git-changes-commit-button')!.click();await settle();view.unmount();await settle();
 view=make();await settle();expect(view.host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Commit once');
 vi.mocked(git.queryWorkingTreeStatus).mockResolvedValue({staged:[],unstaged:[]} as never);finish();await settle();
 expect(view.host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
 view.unmount();await settle();view=make();await settle();expect(view.host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
});

it('keeps runtime selection and drafts isolated on reactive workspace switches inside the same repository', async () => {
 const {probeVersionControlContext}=await import('../git/versionControlProbe');
 vi.mocked(probeVersionControlContext).mockImplementation(async root=>({kind:'ready',workspaceRootPath:root!,repoRoot:'/shared-repo',isBareRepository:false}));
 const all=Array.from({length:4},(_,i)=>({sha:(i+1).toString(16).padStart(40,'0'),parents:[],refs:[],subject:`Shared history ${i}`,authorName:'Test Author',authorEmail:'test@example.invalid',authorTime:1700000000,committerName:'Test Author',committerEmail:'test@example.invalid',committerTime:1700000000}));
 vi.mocked(git.queryCommits).mockResolvedValue(all);
 const root=writable('/shared-repo/folder-a'),state=fromStore(root);
 const view=mountComponent(VersionControlView,{get workspaceRootPath(){return state.current;},windowId:'reactive'});await settle();
 view.host.querySelectorAll<HTMLButtonElement>('.git-history-row')[2]!.click();await settle();
 root.set('/shared-repo/folder-b');await settle();expect(view.host.querySelector('[role=option][aria-selected=true]')?.getAttribute('data-sha')).toBe(all[0].sha);
 root.set('/shared-repo/folder-a');await settle();expect(view.host.querySelector('[role=option][aria-selected=true]')?.getAttribute('data-sha')).toBe(all[2].sha);
 button(view.host,'Commit').click();await settle();let input=view.host.querySelector<HTMLTextAreaElement>('textarea')!;input.value='Draft for folder A';input.dispatchEvent(new Event('input',{bubbles:true}));flushSync();
 root.set('/shared-repo/folder-b');await settle();button(view.host,'Commit').click();await settle();input=view.host.querySelector<HTMLTextAreaElement>('textarea')!;expect(input.value).toBe('');input.value='Draft for folder B';input.dispatchEvent(new Event('input',{bubbles:true}));flushSync();
 root.set('/shared-repo/folder-a');await settle();expect(view.host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Draft for folder A');
 root.set('/shared-repo/folder-b');await settle();expect(view.host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Draft for folder B');
});

it('ignores late panel mutation and busy callbacks after switching workspaces in one repository', async () => {
 const {probeVersionControlContext}=await import('../git/versionControlProbe');
 vi.mocked(probeVersionControlContext).mockImplementation(async root=>({kind:'ready',workspaceRootPath:root!,repoRoot:'/shared-repo',isBareRepository:false}));
 let finishOld!:()=>void,finishNew!:()=>void;
 vi.mocked(git.stageAll).mockImplementationOnce(()=>new Promise<void>(resolve=>finishOld=resolve)).mockImplementationOnce(()=>new Promise<void>(resolve=>finishNew=resolve));
 const root=writable('/shared-repo/late-a'),state=fromStore(root);
 const view=mountComponent(VersionControlView,{get workspaceRootPath(){return state.current;},windowId:'late'});await settle();button(view.host,'Commit').click();await settle();button(view.host,'Stage all').click();await settle();
 root.set('/shared-repo/late-b');await settle();button(view.host,'Commit').click();await settle();button(view.host,'Stage all').click();await settle();
 const reads=vi.mocked(git.queryCurrentBranch).mock.calls.length;finishOld();await settle();
 expect(vi.mocked(git.queryCurrentBranch).mock.calls.length).toBe(reads);
 expect(button(view.host,'Pull').disabled).toBe(true);
 finishNew();await settle();expect(button(view.host,'Pull').disabled).toBe(false);
});

it.each(['bare','notARepository'] as const)('clears old Changes busy state when switching to %s without a Changes panel', async kind => {
 const {probeVersionControlContext}=await import('../git/versionControlProbe');
 vi.mocked(probeVersionControlContext).mockImplementation(async root=>root==='/busy-old'
   ? {kind:'ready',workspaceRootPath:root,repoRoot:root,isBareRepository:false}
   : kind==='bare' ? {kind:'ready',workspaceRootPath:root!,repoRoot:root!,isBareRepository:true} : {kind:'notARepository',workspaceRootPath:root!});
 let finish!:()=>void;vi.mocked(git.stageAll).mockImplementationOnce(()=>new Promise<void>(resolve=>finish=resolve));
 const root=writable('/busy-old'),state=fromStore(root);
 const view=mountComponent(VersionControlView,{get workspaceRootPath(){return state.current;},windowId:`busy-${kind}`});await settle();
 button(view.host,'Commit').click();await settle();button(view.host,'Stage all').click();await settle();
 root.set('/readonly-new');await settle();
 if(kind==='notARepository'){vi.mocked(probeVersionControlContext).mockResolvedValueOnce({kind:'ready',workspaceRootPath:'/bare-after-nonrepo',repoRoot:'/bare-after-nonrepo',isBareRepository:true});root.set('/bare-after-nonrepo');await settle();}
 const more=view.host.querySelector<HTMLButtonElement>('[aria-label="More version control actions"]')!;more.click();await settle();
 const refresh=view.host.querySelector<HTMLButtonElement>('[title="Refresh repository state"]')!;expect(refresh.disabled).toBe(false);
 finish();await settle();expect(refresh.disabled).toBe(false);
});

it('keeps the selected commit when reselecting History or returning from Changes', async () => {
 const {probeVersionControlContext}=await import('../git/versionControlProbe');vi.mocked(probeVersionControlContext).mockImplementation(async root=>({kind:'ready',workspaceRootPath:root!,repoRoot:root!,isBareRepository:false}));
 vi.mocked(git.queryBranches).mockResolvedValue([{name:'feature/one',head:'a'.repeat(40),isCurrent:false,upstream:null,upstreamTrack:null,subject:''}]);
 const commits=Array.from({length:3},(_,i)=>({sha:(i+1).toString(16).padStart(40,'0'),parents:[],refs:[],subject:`Selection ${i}`,authorName:'Test',authorEmail:'test@example.invalid',authorTime:1700000000,committerName:'Test',committerEmail:'test@example.invalid',committerTime:1700000000}));
 vi.mocked(git.queryCommits).mockResolvedValue(commits);const view=mountComponent(VersionControlView,{workspaceRootPath:'/idempotent'});await settle();view.host.querySelectorAll<HTMLButtonElement>('.git-history-row')[2]!.click();await settle();
 const node=(id:string)=>view.host.querySelector<HTMLButtonElement>(`[role=treeitem][title="${id}"]`)!;
 node('history').click();await settle();expect(view.host.querySelector('[aria-selected=true][role=option]')?.getAttribute('data-sha')).toBe(commits[2].sha);
 node('changes').click();await settle();node('history').click();await settle();expect(view.host.querySelector('[aria-selected=true][role=option]')?.getAttribute('data-sha')).toBe(commits[2].sha);
 node('refs/heads/feature/one').click();await settle();view.host.querySelectorAll<HTMLButtonElement>('.git-history-row')[2]!.click();await settle();node('refs/heads/feature/one').click();await settle();expect(view.host.querySelector('[aria-selected=true][role=option]')?.getAttribute('data-sha')).toBe(commits[2].sha);
});
