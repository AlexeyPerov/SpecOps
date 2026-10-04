import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, openSync, closeSync, fstatSync, readFileSync, writeFileSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { CodexRuntimeAdapter } from './adapter';
import { collectContractEvents } from '../../../src/lib/session/adapter/adapter.contract';
import { asSpecOpsTurnId } from '../../../src/lib/session/ids';
/** Explicit authorization permits two paid native requests; never inspects default desktop credentials. */
const enabled = process.env.SPECOPS_CODEX_TWO_ACCOUNT_SMOKE === 'authorized-paid-native-requests';
it.skipIf(!enabled)('opt-in two explicitly supplied account credentials use independent native homes, concurrent requests, restart and logout isolation',async()=>{
 const executable=process.env.SPECOPS_CODEX_EXECUTABLE;
 if(!executable||!isAbsolute(executable))throw new Error('Provide an explicit pinned native executable');
 const imports=[process.env.SPECOPS_CODEX_ACCOUNT_A_KEY_FILE,process.env.SPECOPS_CODEX_ACCOUNT_B_KEY_FILE];
 const keys=imports.map(path=>{
   if(!path||!isAbsolute(path))throw new Error('Provide two explicit private API key file paths');
   const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
   try {const stat=fstatSync(fd);if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>16384)throw new Error('Use private bounded API key files');return readFileSync(fd,'utf8').trim();}finally{closeSync(fd);}
 });
 if(!keys[0]||!keys[1]||keys[0]===keys[1])throw new Error('Provide distinct account credential files');
 const root=mkdtempSync(join(tmpdir(),'specops-two-account-smoke-'));const options={profileRoot:join(root,'profiles'),executable,experimental:true};
 const adapter=new CodexRuntimeAdapter(options);let fresh:CodexRuntimeAdapter|undefined;
 try {
   const profiles=[adapter.store.create('Smoke first'),adapter.store.create('Smoke second')];
   await Promise.all(profiles.map(async(profile,index)=>{writeFileSync(join(adapter.store.home(profile.id),'api-key'),keys[index],{mode:0o600});await adapter.authenticate({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:root,options:{action:'login-api-key'},credential:{kind:'api-key',ref:'profile-api-key'}});}));
   const natives=await Promise.all(profiles.map(profile=>adapter.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:root,runtimeMetadata:{sandbox:'read-only',approvalPolicy:'untrusted'}})));
   const streams=await Promise.all(natives.map((native,index)=>collectContractEvents(adapter.send({native,workspaceRootPath:root,prompt:'Reply with exactly OK. Do not run tools or read files.',turnId:asSpecOpsTurnId('account-smoke-'+index)}))));
   expect(streams.every(events=>events.at(-1)?.type==='turn.finished')).toBe(true);expect(adapter.store.home(profiles[0].id)).not.toBe(adapter.store.home(profiles[1].id));
   for(const key of keys)expect(JSON.stringify(streams)).not.toContain(key);
   adapter.close();fresh=new CodexRuntimeAdapter(options);
   const restored=await Promise.all(natives.map(native=>fresh!.resumeSession({native,workspaceRootPath:root})));expect(restored.map(native=>native.nativeSessionId)).toEqual(natives.map(native=>native.nativeSessionId));
   await fresh.authenticate({runtimeId:'codex',connectionProfileId:profiles[0].id,workspaceRootPath:root,options:{action:'logout'}});
   expect((await fresh.connect(profiles[1].id)).snapshot.state).toBe('authenticated');expect((await fresh.resumeSession({native:natives[1],workspaceRootPath:root})).nativeSessionId).toBe(natives[1].nativeSessionId);
 } finally {adapter.close();fresh?.close();rmSync(root,{recursive:true,force:true});}
},120000);
