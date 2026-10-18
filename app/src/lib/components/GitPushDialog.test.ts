import { beforeEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { writable, fromStore } from 'svelte/store';
import GitPushDialog from './GitPushDialog.svelte';
import { mountComponent } from './_testComponentMount';
import { queryPushSources } from '../git/gitPush';
import { cancelGitCommand, queryRemoteHeads } from '../git/gitService';
vi.mock('../git/gitPush',async original=>({...await original<typeof import('../git/gitPush')>(),queryPushSources:vi.fn()}));
vi.mock('../git/gitService',async original=>({...await original<typeof import('../git/gitService')>(),queryRemoteHeads:vi.fn(),cancelGitCommand:vi.fn().mockResolvedValue({outcome:'cancelled'})}));
const sha='a'.repeat(40);
const branches=[{ref:'refs/heads/main',sha,name:'main',upstream:'origin/review',upstreamRemote:'origin',upstreamBranch:'review',current:true},{ref:'refs/heads/topic/nested',sha:'b'.repeat(40),name:'topic/nested',upstream:'',upstreamRemote:'',upstreamBranch:'',current:false}];
function props(){return {root:'/repo',remotes:[{name:'origin',fetchUrl:'https://user:secret@example.test/repo?token=private',pushUrl:null},{name:'backup',fetchUrl:'/backup',pushUrl:null}],initialRemote:'origin',busy:false,canCancel:false,error:null,result:null,onPush:vi.fn(),onClose:vi.fn(),onCancel:vi.fn()};}
async function settle(){for(let i=0;i<20;i++){await Promise.resolve();flushSync();}}
function button(host:HTMLElement,label:string){return Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.trim()===label)!;}
function field(host:HTMLElement,label:string){return host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;}
function change(input:HTMLInputElement,value:string){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(queryPushSources).mockResolvedValue({branches:branches.map(b=>({...b})),tags:[{ref:'refs/tags/v1',sha}]});vi.mocked(queryRemoteHeads).mockResolvedValue(['review']);});
it('defaults to current branch/upstream with independent tracking and tags opt in; Select all excludes tags',async()=>{
 const p=props(),v=mountComponent(GitPushDialog,p);await settle();expect(v.host.innerHTML).not.toContain('user:secret');expect(v.host.innerHTML).not.toContain('private');
 expect(field(v.host,'Push main').checked).toBe(true);expect(field(v.host,'Push topic/nested').checked).toBe(false);expect(field(v.host,'Remote branch for main').value).toBe('review');expect(field(v.host,'Track main').checked).toBe(false);
 field(v.host,'Track topic/nested').click();v.host.querySelector<HTMLInputElement>('fieldset input')!.click();await settle();button(v.host,'Push').click();
 expect(p.onPush).toHaveBeenCalledWith({remote:'origin',branches:[{ref:'refs/heads/main',sha,destination:'refs/heads/review',track:false},{ref:'refs/heads/topic/nested',sha:'b'.repeat(40),destination:'refs/heads/topic/nested',track:true}],tags:[]});
});
it('validates blank/duplicate destinations; supports explicit tags only with no detached HEAD substitution',async()=>{
 const p=props(),v=mountComponent(GitPushDialog,p);await settle();change(field(v.host,'Remote branch for main'),'');await settle();expect(button(v.host,'Push').disabled).toBe(true);
 change(field(v.host,'Remote branch for main'),'topic/nested');field(v.host,'Push topic/nested').click();await settle();expect(v.host.textContent).toContain('unique');expect(button(v.host,'Push').disabled).toBe(true);
 field(v.host,'Push main').click();field(v.host,'Push topic/nested').click();const tags=Array.from(v.host.querySelectorAll('label')).find(l=>l.textContent?.includes('Push all tags'))!.querySelector('input')!;tags.click();await settle();button(v.host,'Push').click();expect(p.onPush).toHaveBeenCalledWith({remote:'origin',branches:[],tags:[{ref:'refs/tags/v1',sha}]});
});
it('rebuilds mappings/tracking on remote change and ignores stale remote responses',async()=>{
 let resolve!:(heads:string[])=>void;vi.mocked(queryRemoteHeads).mockReturnValueOnce(new Promise(r=>resolve=r));const v=mountComponent(GitPushDialog,props());await settle();expect(button(v.host,'Push').disabled).toBe(true);
 const select=v.host.querySelector('select')!;select.value='backup';select.dispatchEvent(new Event('change',{bubbles:true}));await settle();expect(field(v.host,'Remote branch for main').value).toBe('main');expect(cancelGitCommand).toHaveBeenCalled();resolve(['stale']);await settle();expect(v.host.innerHTML).not.toContain('stale');
});
it('handles auth/load/empty states and refresh',async()=>{
 vi.mocked(queryRemoteHeads).mockRejectedValueOnce(new Error('Authentication failed https://user:secret@example.test/repo'));const v=mountComponent(GitPushDialog,props());await settle();expect(v.host.textContent).toContain('Authentication failed');expect(v.host.innerHTML).not.toContain('user:secret');expect(button(v.host,'Push').disabled).toBe(true);
 // Refresh remains available after load errors.
 button(v.host,'Refresh').click();await settle();expect(button(v.host,'Push').disabled).toBe(false);
 v.unmount();vi.mocked(queryPushSources).mockResolvedValueOnce({branches:[],tags:[]});const empty=mountComponent(GitPushDialog,props());await settle();expect(empty.host.textContent).toContain('No local branches');expect(button(empty.host,'Push').disabled).toBe(true);
});
it('traps/returns focus and dismisses without mutation; keeps progress and cancel visible while busy',async()=>{
 const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();const p=props();const busy=writable(false),state=fromStore(busy);const v=mountComponent(GitPushDialog,{...p,get busy(){return state.current;},canCancel:true});await settle();button(v.host,'Push').focus();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',cancelable:true}));expect(document.activeElement).toBe(v.host.querySelector('select'));
 busy.set(true);await settle();expect(button(v.host,'Push').disabled).toBe(true);window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));expect(p.onClose).not.toHaveBeenCalled();button(v.host,'Cancel operation').click();expect(p.onCancel).toHaveBeenCalledOnce();busy.set(false);await settle();button(v.host,'Cancel').click();expect(p.onClose).toHaveBeenCalledOnce();expect(p.onPush).not.toHaveBeenCalled();v.unmount();await settle();expect(document.activeElement).toBe(trigger);trigger.remove();
});
it('probes the configured push endpoint and rereads local tracking/remote refs after execution refresh',async()=>{
 const p=props();const remotes=p.remotes.map((remote,index)=>({...remote,pushUrl:index===0?'/bare remote with spaces':null}));const token=writable(0),state=fromStore(token);const v=mountComponent(GitPushDialog,{...p,remotes,get refreshToken(){return state.current;}});await settle();expect(queryRemoteHeads).toHaveBeenCalledWith('/repo','origin',expect.objectContaining({configuredPushUrl:'/bare remote with spaces'}));
 vi.mocked(queryPushSources).mockResolvedValueOnce({branches:[{...branches[0],upstream:'origin/new',upstreamBranch:'new'}],tags:[]});token.set(1);await settle();expect(field(v.host,'Remote branch for main').value).toBe('new');expect(queryPushSources).toHaveBeenCalledTimes(2);
});
it('shows partial results without offering an automatic retry',async()=>{
 const p=props();const v=mountComponent(GitPushDialog,{...p,result:{ok:false,cancelled:false,message:'rejected',refs:[{destination:'refs/heads/main',status:'rejected',summary:'non-fast-forward'}]}});await settle();expect(v.host.textContent).toContain('non-fast-forward');expect(v.host.textContent).toContain('did not fully complete');expect(button(v.host,'Push').disabled).toBe(true);
});
it('does not reload branches or re-probe the remote when a refresh lands while showing a push result',async()=>{
 const p=props();const token=writable(0),tokenState=fromStore(token);const pushed=writable<null|{ok:boolean;cancelled:boolean;message:string;refs:[]}>(null),pushedState=fromStore(pushed);
 const v=mountComponent(GitPushDialog,{...p,get refreshToken(){return tokenState.current;},get result(){return pushedState.current;}});await settle();
 expect(queryPushSources).toHaveBeenCalledTimes(1);expect(queryRemoteHeads).toHaveBeenCalledTimes(1);
 pushed.set({ok:true,cancelled:false,message:'done',refs:[]});await settle();token.set(1);await settle();
 expect(queryPushSources).toHaveBeenCalledTimes(1);expect(queryRemoteHeads).toHaveBeenCalledTimes(1);expect(field(v.host,'Push main').checked).toBe(true);expect(v.host.textContent).toContain('Push completed.');
});
