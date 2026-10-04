import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { mountComponent } from './_testComponentMount';
import SessionHandoffDialog from './SessionHandoffDialog.svelte';
import { buildHandoffDraft } from '../services/sessionHandoff';
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), open: vi.fn(), read: vi.fn(), catalog: vi.fn() }));
vi.mock('../services/handoffController', () => ({ collectHandoffDraft: async () => buildHandoffDraft({ sourceSessionId:'source',sourceRuntimeId:'codex',workspaceRootPath:'/workspace',messages:[{id:'u',role:'user',content:'Original goal',createdAt:'t'}] }), confirmHandoff: mocks.confirm, openKnownHandoffTarget: mocks.open }));
vi.mock('../services/handoffPersistence', () => ({ readHandoffJournal: mocks.read }));
vi.mock('../services/agentHostRuntime', () => ({ EMPTY_SESSION_CATALOG: {status:'idle',models:[],modes:[]}, loadSessionCatalogs:mocks.catalog, ensureAgentHostStarted: async()=>({}), getAgentHostClient:()=>({ discover:async()=>({runtimes:[{id:'opencode',label:'OpenCode'}]}), authenticate:async()=>({profiles:[{id:'target-profile',label:'Later profile',runtimeId:'opencode',state:'authenticated',generation:1,hostGeneration:1,support:{apiKey:true}}]}), getStatus:async()=>({}),health:async()=>({}), subscribeProfiles:async()=>()=>{} }) }));
async function settle() { await Promise.resolve(); await tick(); await Promise.resolve(); await tick(); }
function button(host: HTMLElement, text: string) { return [...host.querySelectorAll('button')].find(b=>b.textContent?.includes(text))!; }
beforeEach(()=>{mocks.confirm.mockReset().mockImplementation(async a=>({...a,stage:'settled',outcome:'completed'}));mocks.read.mockReset().mockResolvedValue({attempts:[]});mocks.catalog.mockReset().mockResolvedValue({status:'ready',models:[{id:'model-a'},{id:'model-b'}],modes:[{id:'build'}]});});
describe('handoff review UI',()=>{
 it('edits/removes sections, previews the exact prompt and cancel creates/sends nothing',async()=>{
  const close=vi.fn();const {host}=mountComponent(SessionHandoffDialog,{sourceSessionId:'source',workspaceRootPath:'/workspace',onClose:close});await settle();
  const goal=host.querySelector('textarea[aria-label="Goal"]') as HTMLTextAreaElement;goal.value='Edited reviewed goal';goal.dispatchEvent(new Event('input',{bubbles:true}));await settle();
  const check=host.querySelector('fieldset input[type="checkbox"]') as HTMLInputElement;check.click();await settle();
  expect((host.querySelector('textarea[aria-label="Exact first prompt"]') as HTMLTextAreaElement).value).not.toContain('Edited reviewed goal');
  button(host,'cancel review').click();expect(close).toHaveBeenCalled();expect(mocks.confirm).not.toHaveBeenCalled();
 });
 it('freezes actual approval after failure and confirms the displayed bytes, not refreshed catalog defaults',async()=>{
  mocks.confirm.mockRejectedValueOnce(new Error('Lost acknowledgement'));
  const {host}=mountComponent(SessionHandoffDialog,{sourceSessionId:'source',workspaceRootPath:'/workspace',onClose:vi.fn()});await settle();
  await vi.waitFor(()=>expect([...host.querySelectorAll('select')].some(s=>[...s.options].some(o=>o.value==='target-profile'))).toBe(true));
  const profile=[...host.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='target-profile'))!;profile.value='target-profile';profile.dispatchEvent(new Event('change',{bubbles:true}));await settle();
  const preview=(host.querySelector('textarea[aria-label="Exact first prompt"]') as HTMLTextAreaElement).value;
  button(host,'Confirm and send').click();await settle();expect(mocks.confirm).toHaveBeenCalledTimes(1);expect(mocks.confirm.mock.calls[0][0].approvedPrompt).toBe(preview);
  expect((host.querySelector('textarea[aria-label="Exact first prompt"]') as HTMLTextAreaElement).value).toBe(preview);
  button(host,'Confirm and send').click();await settle();expect(mocks.confirm.mock.calls[1][0].id).toBe(mocks.confirm.mock.calls[0][0].id);expect(mocks.confirm.mock.calls[1][0].approvedPrompt).toBe(preview);
 });
 it('saved approval first opens exact frozen review without dispatch',async()=>{
  const saved={version:1,id:'saved',sourceSessionId:'source',targetSessionId:'target',workspaceRootPath:'/workspace',stage:'approved',approvedAt:'2026-10-04T00:00:00Z',approvedPrompt:'Saved exact packet',target:{runtimeId:'opencode',connectionProfileId:'target-profile',modelId:'model-a'}};
  mocks.read.mockResolvedValue({attempts:[saved]});const {host}=mountComponent(SessionHandoffDialog,{sourceSessionId:'source',workspaceRootPath:'/workspace',onClose:vi.fn()});await settle();
  button(host,'Review saved approval').click();await settle();expect(mocks.confirm).not.toHaveBeenCalled();expect((host.querySelector('textarea[aria-label="Exact first prompt"]') as HTMLTextAreaElement).value).toBe('Saved exact packet');
 });
});
