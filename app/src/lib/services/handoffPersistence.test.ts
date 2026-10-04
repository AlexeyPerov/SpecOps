import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeHandoffJournal, handoffJournalWriter, readHandoffJournal, mintHandoffSendPermit, consumeHandoffSendPermit } from './handoffPersistence';
import { executeHandoff, type HandoffAttempt } from './sessionHandoff';
const storage = vi.hoisted(()=>({ raw: null as string|null, fail: false }));
vi.mock('@tauri-apps/api/path',()=>({join:async(...parts:string[])=>parts.join('/')}));
vi.mock('./chatPersistencePaths',()=>({getWorkspaceSessionsDir:async()=>'/private/storage/chat/workspace'}));
vi.mock('@tauri-apps/api/core',()=>({invoke:async(command:string,args:{content:string;expected:string|null})=>{
 if(command==='handoff_read_journal')return storage.raw;
 if(command==='handoff_write_journal'){if(storage.fail)throw new Error('Durable storage unavailable');if(args.expected!==storage.raw)throw new Error('CAS changed');storage.raw=args.content;return;}
 throw new Error('Unexpected command');
}}));
const approved=():HandoffAttempt=>({version:1,id:'attempt',sourceSessionId:'source',targetSessionId:'target',workspaceRootPath:'/workspace',target:{runtimeId:'claude',connectionProfileId:'profile',modelId:'model'},approvedPrompt:'Reviewed exact prompt',approvedAt:'2026-10-04T00:00:00Z',stage:'approved'});
beforeEach(()=>{storage.raw=null;storage.fail=false;});
describe('handoff journal and send permits',()=>{
 it('two independently loaded window snapshots compete through CAS: only one creates and sends',async()=>{
  const a=await handoffJournalWriter('/workspace');const b=await handoffJournalWriter('/workspace');const create=vi.fn(async()=>({runtimeId:'claude' as const,connectionProfileId:'profile',modelId:'model',nativeSessionId:'fresh' as never}));const send=vi.fn(async()=>true);const deps={validate:async()=>{},create,bind:async()=>{},send};
  const results=await Promise.allSettled([executeHandoff(approved(),{...deps,save:a.save}),executeHandoff(approved(),{...deps,save:b.save})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(create).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1);expect((await readHandoffJournal('/workspace')).attempts[0].stage).toBe('settled');
 });
 it('strict writer failure blocks native creation; no weaker fallback is invoked',async()=>{storage.fail=true;const writer=await handoffJournalWriter('/workspace');const create=vi.fn();await expect(executeHandoff(approved(),{save:writer.save,validate:async()=>{},create,bind:async()=>{},send:vi.fn()})).rejects.toThrow('Durable');expect(create).not.toHaveBeenCalled();});
 it('oversized/corrupt/native mismatch/workspace mismatch fails closed',async()=>{
  expect(()=>decodeHandoffJournal('x'.repeat(1_048_577))).toThrow('limit');expect(()=>decodeHandoffJournal('{broken')).toThrow();
  const a=approved();storage.raw=JSON.stringify({version:1,attempts:[{...a,stage:'created',native:{runtimeId:'claude',connectionProfileId:'profile',nativeSessionId:'n',modelId:'different'}}]});expect(()=>decodeHandoffJournal(storage.raw!)).toThrow();storage.raw=JSON.stringify({version:1,attempts:[{...a,workspaceRootPath:'/other'}]});await expect(readHandoffJournal('/workspace')).rejects.toThrow('workspace');
 });
 it('initial-send permits are scoped, exact and consumed once',()=>{const a=approved();const token=mintHandoffSendPermit(a);expect(consumeHandoffSendPermit(token,'/workspace','target','different')).toBe(false);expect(consumeHandoffSendPermit(token,'/workspace','target',a.approvedPrompt)).toBe(false);const valid=mintHandoffSendPermit(a);expect(consumeHandoffSendPermit(valid,'/workspace','target',a.approvedPrompt)).toBe(true);expect(consumeHandoffSendPermit(valid,'/workspace','target',a.approvedPrompt)).toBe(false);});
});
