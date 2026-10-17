import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { writable, fromStore } from 'svelte/store';
import GitPullDialog from './GitPullDialog.svelte';
import { mountComponent } from './_testComponentMount';
import { cancelGitCommand, queryRemoteHeads, queryGitOperationState, queryPullSnapshot } from '../git/gitService';
vi.mock('../git/gitService', async original => ({ ...await original<typeof import('../git/gitService')>(), cancelGitCommand:vi.fn().mockResolvedValue({outcome:'cancelled'}), queryRemoteHeads:vi.fn(), queryPullSnapshot:vi.fn(), queryGitOperationState:vi.fn() }));
async function settle(){ for(let n=0;n<20;n++){await Promise.resolve();flushSync();} }
function button(host:HTMLElement, label:string) { return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()===label)!; }
const remotes=[{name:'origin',fetchUrl:'https://secret:password@example.test/repo?token=private',pushUrl:null},{name:'backup',fetchUrl:'ssh://git@example.test/long/path',pushUrl:null}];
function props(){ return {root:'/repo',remotes,initialRemote:'origin',initialBranch:'main',busy:false,canCancel:false,error:null,onPull:vi.fn(),onClose:vi.fn(),onCancel:vi.fn()}; }
beforeEach(()=>{ vi.resetAllMocks();vi.mocked(queryRemoteHeads).mockResolvedValue(['main','topic/nested']);vi.mocked(queryPullSnapshot).mockResolvedValue({head:'abc',branch:'main'});vi.mocked(queryGitOperationState).mockResolvedValue({kind:'none',conflicts:[]});vi.mocked(cancelGitCommand).mockResolvedValue({outcome:'cancelled'}); });
describe('mounted Pull modal',()=>{
 it('redacts URL credentials, shows explicit defaults, traps focus, returns it, and Cancel never runs Pull',async()=>{
   const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();
   const callbacks=props(); const view=mountComponent(GitPullDialog,callbacks);await settle();
   expect(view.host.textContent).toContain('https://***@example.test/repo?token=***');expect(view.host.innerHTML).not.toContain('secret:password');expect(view.host.innerHTML).not.toContain('private');
   expect(view.host.textContent).toContain('local branch: main');expect(view.host.querySelector('option[disabled]')?.textContent).toContain('not supported');
   const checks=view.host.querySelectorAll<HTMLInputElement>('input');expect(Array.from(checks).map(c=>c.checked)).toEqual([true,false,false,false]);
   button(view.host,'Pull').focus();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',cancelable:true}));expect(document.activeElement).toBe(view.host.querySelector('select'));
   window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));expect(callbacks.onClose).toHaveBeenCalledOnce();expect(callbacks.onPull).not.toHaveBeenCalled();view.unmount();await settle();expect(document.activeElement).toBe(trigger);trigger.remove();
 });
 it('submits immutable target/snapshot, preserves merge settings while disabling them for rebase',async()=>{
   const callbacks=props(), view=mountComponent(GitPullDialog,callbacks);await settle();
   const checks=view.host.querySelectorAll<HTMLInputElement>('input');checks[1]!.click();checks[2]!.click();checks[3]!.click();await settle();expect(Array.from(checks).slice(0,3).every(c=>c.disabled)).toBe(true);
   button(view.host,'Pull').click();expect(callbacks.onPull).toHaveBeenCalledWith({remoteName:'origin',branchName:'main'},{strategy:'rebase',commit:true,log:true,noFastForward:true},{head:'abc',branch:'main'});
   checks[3]!.click();await settle();expect(checks[1]!.checked).toBe(true);expect(checks[1]!.disabled).toBe(false);
 });
 it('cancels stale remote head requests and ignores out-of-order results',async()=>{
   let resolve!:(value:string[])=>void;vi.mocked(queryRemoteHeads).mockImplementationOnce(()=>new Promise(r=>resolve=r));const view=mountComponent(GitPullDialog,props());await settle();expect(button(view.host,'Pull').disabled).toBe(true);
   vi.mocked(queryRemoteHeads).mockResolvedValueOnce(['backup-only']);const select=view.host.querySelector<HTMLSelectElement>('select')!;select.value='backup';select.dispatchEvent(new Event('change',{bubbles:true}));await settle();expect(cancelGitCommand).toHaveBeenCalled();resolve(['stale']);await settle();expect(view.host.textContent).toContain('backup-only');expect(view.host.textContent).not.toContain('stale');
 });
 it('exposes empty/auth/error states and Refresh recovers',async()=>{
   vi.mocked(queryRemoteHeads).mockRejectedValueOnce(new Error('Authentication failed for https://secret:password@example.test/repo'));const view=mountComponent(GitPullDialog,props());await settle();expect(view.host.querySelector('[role=alert]')?.textContent).toContain('Authentication failed');expect(view.host.innerHTML).not.toContain('secret:password');expect(button(view.host,'Pull').disabled).toBe(true);
   vi.mocked(queryRemoteHeads).mockResolvedValueOnce([]);button(view.host,'Refresh').click();await settle();expect(view.host.textContent).toContain('No branches');expect(button(view.host,'Pull').disabled).toBe(true);
   button(view.host,'Refresh').click();await settle();expect(button(view.host,'Pull').disabled).toBe(false);
 });
 it('blocks unresolved Git state, detached/unborn errors and displays operation errors',async()=>{
   vi.mocked(queryGitOperationState).mockResolvedValueOnce({kind:'merge',conflicts:['file']});const view=mountComponent(GitPullDialog,props());await settle();expect(button(view.host,'Pull').disabled).toBe(true);expect(view.host.textContent).toContain('Finish the current Git operation');view.unmount();await settle();
   vi.mocked(queryPullSnapshot).mockRejectedValueOnce(new Error('Checkout a local branch before pulling.'));const detached=mountComponent(GitPullDialog,props());await settle();expect(button(detached.host,'Pull').disabled).toBe(true);expect(detached.host.textContent).toContain('Checkout a local branch');
 });
 it('holds the modal during execution and requests cancellation without pretending the process finished',async()=>{
   const callbacks=props();const busy=writable(false),state=fromStore(busy);const view=mountComponent(GitPullDialog,{...callbacks,get busy(){return state.current;},canCancel:true});await settle();busy.set(true);await settle();expect(button(view.host,'Pull').disabled).toBe(true);window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));expect(callbacks.onClose).not.toHaveBeenCalled();button(view.host,'Cancel operation').click();expect(callbacks.onCancel).toHaveBeenCalledOnce();expect(view.host.querySelector('[role=dialog]')).not.toBeNull();
 });
 it('cancels an in-flight probe on teardown',async()=>{
   vi.mocked(queryRemoteHeads).mockReturnValueOnce(new Promise(()=>{}));const view=mountComponent(GitPullDialog,props());await settle();view.unmount();await settle();expect(cancelGitCommand).toHaveBeenCalledWith(expect.stringContaining('remote-heads-'));
 });
});
