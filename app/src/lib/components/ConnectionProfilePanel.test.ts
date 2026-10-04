import { beforeEach, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { mountComponent } from './_testComponentMount';
import ConnectionProfilePanel from './ConnectionProfilePanel.svelte';
const mocks=vi.hoisted(()=>({auth:vi.fn(),updates:undefined as undefined|((update:unknown)=>void)}));
vi.mock('../services/agentHostRuntime',()=>({ensureAgentHostStarted:async()=>{},loadSessionCatalogs:async()=>{},getAgentHostClient:()=>({discover:async()=>({runtimes:[{id:'codex',label:'Codex'},{id:'claude',label:'Claude'}]}),authenticate:mocks.auth,getStatus:async()=>({running:true,generation:1,health:'healthy'}),health:async()=>({status:'healthy'}),subscribeProfiles:async(callback:(update:unknown)=>void)=>{mocks.updates=callback;return()=>{};}})}));
const profile={id:'stable-profile-id',runtimeId:'codex',label:'First',createdAt:'t',generation:1,state:'authenticated',account:{type:'chatgpt',email:'native@example.test',planType:'plus'},support:{browser:true,device:true,apiKey:true}};
async function settle(){for(let index=0;index<8;index++){await Promise.resolve();await tick();}}
function button(host:HTMLElement,text:string){return [...host.querySelectorAll('button')].find(node=>node.textContent===text)!;}
beforeEach(()=>{let removed=false;mocks.auth.mockReset().mockImplementation(async(request)=>{if(request.options.action==='remove-profile')removed=true;return ({status:'challenge',profiles:removed?[]:[profile],...(request.options.action==='rename-profile'?{profile:{...profile,label:request.options.label}}:request.options.action==='remove-profile'?{profile:{...profile,state:'missing-profile'}}:{})});});});
it('bound session displays native account and stable ID, rename keeps binding and removal leaves explicit missing state',async()=>{
 const onSelect=vi.fn();const {host}=mountComponent(ConnectionProfilePanel,{runtimeId:'codex',connectionProfileId:profile.id,bound:true,onSelect});await settle();
 expect(host.textContent).toContain('native@example.test');expect(host.textContent).toContain(profile.id);expect((host.querySelector('select') as HTMLSelectElement).disabled).toBe(true);
 const input=host.querySelector('input[aria-label="Rename profile"]') as HTMLInputElement;input.value='Updated';input.dispatchEvent(new Event('input',{bubbles:true}));await settle();button(host,'Rename profile').click();await settle();
 expect(mocks.auth.mock.calls.some(([request])=>request.connectionProfileId===profile.id&&request.options.action==='rename-profile'&&request.options.label==='Updated')).toBe(true);expect(onSelect).not.toHaveBeenCalled();
 button(host,'Remove profile').click();await settle();expect(host.textContent).toContain('saved profile is missing');expect(onSelect).not.toHaveBeenCalled();
});
it('runtime without profile-management capabilities exposes no Codex rename/remove action',async()=>{
 mocks.auth.mockResolvedValue({status:'challenge',profiles:[{...profile,runtimeId:'claude'}]});const {host}=mountComponent(ConnectionProfilePanel,{runtimeId:'claude',connectionProfileId:profile.id,onSelect:vi.fn()});await settle();
 expect([...host.querySelectorAll('button')].map(button=>button.textContent)).not.toContain('Rename profile');expect([...host.querySelectorAll('button')].map(button=>button.textContent)).not.toContain('Remove profile');
});
