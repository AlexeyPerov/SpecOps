import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeCursorDriver } from './session';
import { resolveCursorAssets, CURSOR_SDK_VERSION } from './runtime';
import { CursorRuntimeAdapter } from './adapter';
import { CursorFixtureDriver } from './fixtures';
import { collectContractEvents } from '../../../src/lib/session/adapter/adapter.contract';
import { sessionSupportSnapshot } from '../../../src/lib/services/sessionSupport';
import { asSpecOpsTurnId } from '../../../src/lib/session/ids';
const roots:string[]=[];
const root=()=>{const p=mkdtempSync(join(tmpdir(),'specops-cursor-hardening-'));roots.push(p);return p;};
afterEach(()=>roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));
const canary='private-cursor-key-canary';
it.each([{status:401,reason:'auth-required'},{status:403,reason:'auth-required'},{code:16,reason:'auth-required'},{status:429,reason:'quota'},{code:8,reason:'quota'},{code:'ENOTFOUND',reason:'offline'},{code:14,reason:'offline'},{code:'unknown',reason:'native'}])('native worker classifies $reason from safe discriminants and discards raw secret errors',async discriminant=>{
 const path=root(),store=join(path,'store');mkdirSync(store,{mode:0o700});const sdk=join(path,'sdk.mjs');
 writeFileSync(sdk,`export class JsonlLocalAgentStore {} export const Agent={create:async()=>{console.log('${canary}');process.stderr.write('${canary}');throw Object.assign(new Error('${canary}'),${JSON.stringify(discriminant)})}};`);
 const driver=nativeCursorDriver({...resolveCursorAssets(),sdk},{HOME:path,PATH:process.env.PATH},3000);const frames=[];
 for await(const frame of driver.operation({action:'create',store,cwd:path,key:canary,binding:{}},new AbortController().signal))frames.push(frame);
 expect(frames).toEqual([{type:'failure',reason:discriminant.reason}]);expect(JSON.stringify(frames)).not.toContain(canary);
});
it.each(['malformed','oversize','death','timeout'] as const)('actual worker %s terminates boundedly without exposing payloads',async fault=>{
 const path=root(),worker=join(path,'session-worker.mjs');
 const body=fault==='malformed'?`process.stdout.write('secret-${canary}\\n')`:fault==='oversize'?`process.stdout.write('x'.repeat(1048577))`:fault==='death'?`process.stderr.write('${canary}');process.exit(3)`:`setInterval(()=>{},1000)`;
 writeFileSync(worker,body);const driver=nativeCursorDriver({...resolveCursorAssets(),worker:join(path,'worker.mjs')},{HOME:path,PATH:process.env.PATH},250);
 const started=Date.now();await expect((async()=>{for await(const _ of driver.operation({action:'create',store:path,cwd:path,key:canary,binding:{}},new AbortController().signal)){} })()).rejects.toThrow(/Malformed|capacity|unexpectedly|timed out/);
 expect(Date.now()-started).toBeLessThan(3000);
});
class HistoryFault extends CursorFixtureDriver {
 faultKind='';
 override async *operation(req:Parameters<CursorFixtureDriver['operation']>[0],signal:AbortSignal){
  let first:any;for await(const frame of super.operation(req,signal)){
   if(req.action==='history'&&frame.type==='historyEvent'&&!first){first=frame;if(this.faultKind==='date')frame.createdAt=Number.MAX_VALUE;yield frame;if(this.faultKind==='duplicate')yield frame;continue;}
   yield frame;if(req.action==='history'&&frame.type==='historyDone'&&this.faultKind==='after-done')yield first;
  }
 }
}
it.each(['duplicate','date','after-done'])('malformed authoritative history %s preserves private binding and never dispatches a new run',async fault=>{
 const path=root(),driver=new HistoryFault(join(path,'fixture.json'));const a=new CursorRuntimeAdapter({profileRoot:join(path,'profiles'),assets:()=>({sdk:'fixture',worker:'fixture',root:'fixture',sdkVersion:CURSOR_SDK_VERSION}),control:async(_a,_e,action)=>action==='probe'?{ok:true,probe:{durableAgent:true,nativeId:true,store:'jsonl',node:process.version}}:{ok:true,models:[{id:'native-model',displayName:'Native model'}]},driver:()=>driver});
 try{const p=a.store.create('private profile');a.store.saveKey(p.id,canary);await a.refresh(p.id);const native=await a.createSession({runtimeId:'cursor',connectionProfileId:p.id,workspaceRootPath:path,modelId:'native-model'});await collectContractEvents(a.send({native,workspaceRootPath:path,prompt:'secret',turnId:asSpecOpsTurnId('user'),context:{clientUserMessageId:'user'}}));
 const file=join(a.store.home(p.id),`session-${native.nativeSessionId}.json`),before=readFileSync(file,'utf8');driver.faultKind=fault;
 await expect(a.resumeSession({native,workspaceRootPath:path})).rejects.toThrow(/Malformed|acknowledgement/);expect(readFileSync(file,'utf8')).toBe(before);expect(before).not.toContain(canary);expect(driver.calls.filter(c=>c.action==='send')).toHaveLength(1);
 }finally{await a.close();}
});
it('exact current, replacement and pending import secrets never enter profile responses or control notifications, including logout and fresh host',async()=>{
 const path=root(),a=new CursorRuntimeAdapter({profileRoot:path,assets:()=>({sdk:'fixture',worker:'fixture',root:'fixture',sdkVersion:CURSOR_SDK_VERSION}),control:async(_a,_e,action)=>action==='probe'?{ok:true,probe:{durableAgent:true,nativeId:true,store:'jsonl',node:process.version}}:{ok:true,models:[]}});
 expect(()=>a.store.create('x'.repeat(81))).toThrow('80 characters');
 const second='replacement-private-key-canary',p=a.store.create(`${canary} ${second}`),notifications:any[]=[];a.onAuthUpdate=n=>notifications.push(n);
 writeFileSync(join(a.store.home(p.id),'api-key'),canary,{mode:0o600});
 const req={runtimeId:'cursor' as const,workspaceRootPath:path,connectionProfileId:p.id};
 const first=await a.authenticate({...req,credential:{kind:'api-key',ref:'profile-api-key'},options:{action:'login-api-key'}});
 writeFileSync(join(a.store.home(p.id),'api-key'),second,{mode:0o600});
 const replaced=await a.authenticate({...req,credential:{kind:'api-key',ref:'profile-api-key'},options:{action:'login-api-key'}});const logout=await a.authenticate({...req,options:{action:'logout'}});
 expect(JSON.stringify({first,replaced,logout,notifications})).not.toContain(canary);expect(JSON.stringify({replaced,logout,notifications:notifications.filter(n=>n.generation>=replaced.profile!.generation)})).not.toContain(second);
 const support=sessionSupportSnapshot({running:true,generation:1,health:'healthy',pid:1,protocolVersion:1,hostVersion:'fixture',restartCount:0,lastError:null},await a.health(),replaced.profile);expect(support).not.toMatch(new RegExp(`${canary}|${second}`));
 await a.close();const fresh=new CursorRuntimeAdapter({profileRoot:path});try{expect(JSON.stringify(await fresh.authenticate({...req,options:{action:'list-profiles'}}))).not.toMatch(new RegExp(`${canary}|${second}`));}finally{await fresh.close();}
});
it.each([undefined,'disconnect'] as const)('terminal %s releases ownership before publication; an old generator cannot overwrite immediate native resume',async fault=>{
 const path=root(),driver=new CursorFixtureDriver(join(path,'fixture.json'));const a=new CursorRuntimeAdapter({profileRoot:join(path,'profiles'),assets:()=>({sdk:'fixture',worker:'fixture',root:'fixture',sdkVersion:CURSOR_SDK_VERSION}),control:async(_a,_e,action)=>action==='probe'?{ok:true,probe:{durableAgent:true,nativeId:true,store:'jsonl',node:process.version}}:{ok:true,models:[{id:'native-model',displayName:'Native model'}]},driver:()=>driver});
 try{const p=a.store.create('Profile');a.store.saveKey(p.id,canary);await a.refresh(p.id);const native=await a.createSession({runtimeId:'cursor',connectionProfileId:p.id,workspaceRootPath:path,modelId:'native-model'});driver.fault=fault;
 const iterator=a.send({native,workspaceRootPath:path,prompt:'hello',turnId:asSpecOpsTurnId('user'),context:{clientUserMessageId:'user'}})[Symbol.asyncIterator]();let event=await iterator.next();while(!event.done&&!['turn.finished','turn.failed'].includes(event.value.type))event=await iterator.next();expect(event.value.type).toBe(fault?'turn.failed':'turn.finished');
 await a.resumeSession({native,workspaceRootPath:path});const file=join(a.store.home(p.id),`session-${native.nativeSessionId}.json`),settled=readFileSync(file,'utf8');expect((await iterator.next()).done).toBe(true);expect(readFileSync(file,'utf8')).toBe(settled);
 }finally{await a.close();}
});
