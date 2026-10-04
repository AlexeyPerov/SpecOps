import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexRuntimeAdapter } from './adapter';
import { threadFixture } from './threadFixtures';
import { NativeTurn } from './turn';
import { CodexTransport } from './transport';
import { asSpecOpsTurnId, asNativeSessionId } from '../../../src/lib/session/ids';
import { runAdapterContractSuite, collectContractEvents } from '../../../src/lib/session/adapter/adapter.contract';
import type { NativeSessionRef, AgentTurnRequest } from '../../../src/lib/session/adapter';
import type { SessionEvent } from '../../../src/lib/session/events';
const clean: (() => void)[] = [];
afterEach(() => { clean.splice(0).reverse().forEach(close => close()); sharedRoot = undefined; });
const temporary = () => { const root = mkdtempSync(join(tmpdir(),'specops-native-turn-')); clean.push(() => rmSync(root,{recursive:true,force:true})); return root; };
let sharedRoot: string | undefined;
function runtime(root = temporary(), options = {}) { const executable = join(root,'native-fixture.cjs');writeFileSync(executable,threadFixture,{mode:0o700}); const adapter = new CodexRuntimeAdapter({profileRoot:join(root,'profiles'),executable,...options});clean.push(()=>adapter.close());return adapter; }
async function setup(options = {}) { const adapter = runtime(undefined,options); const profile = adapter.store.create('B'); await adapter.authenticate({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:'',options:{action:'experimental-on'}}); const workspace=temporary(); const native = await adapter.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:workspace}); return { adapter,native,workspace,profile }; }
const request = (native: NativeSessionRef,workspace: string,prompt = 'hello',turn = 'specops-turn'): AgentTurnRequest => ({native,workspaceRootPath:workspace,prompt,turnId:asSpecOpsTurnId(turn),context:{clientUserMessageId:'user-'+turn}});
async function interact(adapter: CodexRuntimeAdapter,native: NativeSessionRef,workspace: string,prompt: string,reply: 'once'|'reject'='once') { const events: SessionEvent[]=[];for await(const event of adapter.send(request(native,workspace,prompt))) { events.push(event);if(event.type==='permission.requested')await adapter.replyPermission({native,turnId:asSpecOpsTurnId('specops-turn'),permissionId:event.request.permissionId,reply});if(event.type==='question.requested')await adapter.replyQuestion({native,turnId:asSpecOpsTurnId('specops-turn'),questionId:event.request.questionId,answer:'One'}); } return events; }
describe('native developer session',()=>{
 it('blocks baseline coding before work, persists explicit profile opt-in and distinct threads/settings',async()=>{
   const adapter=runtime();const profile=adapter.store.create('B'); await expect(adapter.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:'/work'})).rejects.toThrow('Enable experimental');
   await adapter.authenticate({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:'',options:{action:'experimental-on'}});
   const a=await adapter.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:'/work',modelId:'fixture-model',modeId:'plan',runtimeMetadata:{effort:'high',sandbox:'read-only',approvalPolicy:'untrusted'}});
   const b=await adapter.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:'/work'});expect(a.nativeSessionId).not.toBe(b.nativeSessionId);expect(a.runtimeMetadata).toMatchObject({effort:'high',sandbox:'read-only',approvalPolicy:'untrusted',writeCapability:false});
   expect(adapter.store.require(profile.id).experimental).toBe(true);expect((await adapter.connect(profile.id)).transport?.running).toBe(true);
   await expect(adapter.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:'/work',runtimeMetadata:{effort:'ultra'}})).rejects.toThrow('reasoning effort');
 });
 it('assembles deterministic text/reasoning/usage/unknown and monotonic cursor across sends',async()=>{
   const {adapter,native,workspace}=await setup();const first=await collectContractEvents(adapter.send(request(native,workspace,'unknown')));const second=await collectContractEvents(adapter.send(request(native,workspace,'hello','second')));
   expect(first.find(e=>e.type==='text.finished')).toMatchObject({text:'Hello native'});expect(first.some(e=>e.type==='reasoning.ended')).toBe(true);expect(first.some(e=>e.type==='diagnostic'&&e.reason==='unknown-native')).toBe(true);
   expect(second[0]!.seq).toBeGreaterThan(first.at(-1)!.seq);expect(second.find(e=>e.type==='usage.recorded')).toMatchObject({usage:{input:10,output:3}});expect(first.find(e=>e.type==='text.delta')).toMatchObject({nativeTurnId:'native-turn-0',nativeItemId:'native-turn-0-text'});
 });
 it('maps command/file allow and deny, native file effect and rejects duplicate/cross-turn replies',async()=>{
   const {adapter,native,workspace}=await setup();const allowed=await interact(adapter,native,workspace,'approval');const denied=await interact(adapter,native,workspace,'deny','reject');expect(allowed.find(e=>e.type==='tool.completed')).toMatchObject({status:'success'});expect(denied.find(e=>e.type==='tool.completed')).toMatchObject({status:'failure'});
   const edited=await interact(adapter,native,workspace,'edit');expect(edited.some(e=>e.type==='diff.posted')).toBe(true);expect(readFileSync(join(workspace,'fixture.txt'),'utf8')).toBe('fixture edit');
   const id=allowed.find(e=>e.type==='permission.requested');if(id?.type==='permission.requested')await expect(adapter.replyPermission({native,turnId:asSpecOpsTurnId('specops-turn'),permissionId:id.request.permissionId,reply:'once'})).rejects.toThrow('expired');
 });
 it('answers pinned questions only on explicitly opted profile and timeout/cancel closes pending requests',async()=>{
   const {adapter,native,workspace}=await setup({interactionTimeoutMs:40});const answered=await interact(adapter,native,workspace,'question');expect(answered.find(e=>e.type==='text.finished')).toMatchObject({text:'One'});
   const expired=await collectContractEvents(adapter.send(request(native,workspace,'approval')));expect(expired.at(-1)?.type).toBe('turn.cancelled');
   const iterator=adapter.send(request(native,workspace,'cancel','cancel-turn'))[Symbol.asyncIterator]();await iterator.next();await new Promise(r=>setTimeout(r,15));const before=Date.now();await adapter.cancel({native,turnId:asSpecOpsTurnId('cancel-turn')});const rest: SessionEvent[]=[];for(let next=await iterator.next();!next.done;next=await iterator.next())rest.push(next.value);expect(rest.at(-1)?.type).toBe('turn.cancelled');expect(Date.now()-before).toBeLessThan(1000);
 });
 it('settles native failure/lost-child, sibling remains usable and completed history resumes without replay',async()=>{
   const {adapter,native,workspace,profile}=await setup();const second=await adapter.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:workspace});expect((await collectContractEvents(adapter.send(request(native,workspace,'failure')))).at(-1)?.type).toBe('turn.failed');await collectContractEvents(adapter.send(request(native,workspace)));
   const missing={...native,nativeSessionId:asNativeSessionId('missing')};await expect(adapter.resumeSession({native:missing,workspaceRootPath:workspace})).rejects.toMatchObject({code:'session-not-found'});
   expect((await collectContractEvents(adapter.send(request(second,workspace,'child-failure')))).at(-1)?.type).toBe('turn.failed');
   const resumed=await adapter.resumeSession({native,workspaceRootPath:workspace});expect(resumed.nativeSessionId).toBe(native.nativeSessionId);expect(resumed.history?.filter(m=>m.role==='user')).toHaveLength(2);expect(resumed.history?.find(m=>m.content==='Hello native')).toBeDefined();await collectContractEvents(adapter.send(request(resumed,workspace,'hello','continued')));
   const conn=await adapter.connect(profile.id);const requests=readFileSync(join(adapter.store.home(profile.id),'fixture-requests.jsonl'),'utf8');expect(requests.match(/thread\/start/g)).toHaveLength(2);expect(conn.snapshot.state).toBe('authenticated');
 });
 it('rejects stale native frame generations/turns and bounds oversized delta without recursion',async()=>{
   const native={runtimeId:'codex' as const,connectionProfileId:'profile',nativeSessionId:asNativeSessionId('thread')};const transport=new CodexTransport('/missing','/missing');let seq=0;const turn=new NativeTurn(request(native,'/work'),transport,()=>++seq);turn.bind('native-turn');turn.notification('item/agentMessage/delta',{threadId:'thread',turnId:'stale',itemId:'text',delta:'ignored'},0);turn.notification('item/agentMessage/delta',{threadId:'thread',turnId:'native-turn',itemId:'text',delta:'ignored'},1);turn.notification('item/agentMessage/delta',{threadId:'thread',turnId:'native-turn',itemId:'text',delta:'x'.repeat(5*1024*1024)},0);const events=[];for await(const event of turn.events())events.push(event);expect(events[0]?.type).toBe('turn.started');expect(events.at(-1)?.type).toBe('turn.failed');expect(events.filter(e=>e.type==='turn.failed')).toHaveLength(1);
 });
});
class ContractRuntime extends CodexRuntimeAdapter {
 readonly profileId: string;
 constructor(root: string,executable: string){super({profileRoot:join(root,'profiles'),executable});this.profileId=this.store.list()[0]?.id??this.store.create('Contract').id;this.store.setExperimental(this.profileId,true);}
 override async authenticate(input: Parameters<CodexRuntimeAdapter['authenticate']>[0]) { return super.authenticate({ ...input, connectionProfileId: this.profileId }); }
 override async createSession(input: Parameters<CodexRuntimeAdapter['createSession']>[0]) { return super.createSession({...input,connectionProfileId:this.profileId}); }
}
runAdapterContractSuite({runtimeId:'codex',finishPrompt:'unknown',cancelPrompt:'cancel',create:async()=>{sharedRoot??=temporary();const executable=join(sharedRoot,'fixture.cjs');writeFileSync(executable,threadFixture,{mode:0o700});const adapter=new ContractRuntime(sharedRoot,executable);clean.push(()=>adapter.close());return adapter;},createFaultAdapter:async()=>{sharedRoot=undefined;const root=temporary();const executable=join(root,'fixture.cjs');writeFileSync(executable,threadFixture,{mode:0o700});const adapter=new ContractRuntime(root,executable);clean.push(()=>adapter.close());return adapter;}});
