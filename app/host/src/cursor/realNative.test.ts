import { expect, it } from 'vitest';
import { constants, openSync, fstatSync, readFileSync, closeSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CursorRuntimeAdapter } from './adapter';
import { verifyCursorAssetDirectory } from './runtime';
import { asSpecOpsTurnId } from '../../../src/lib/session/ids';
import { collectContractEvents } from '../../../src/lib/session/adapter/adapter.contract';
// Explicit opt-in sends paid native inference; global account state is never read.
const enabled=process.env.SPECOPS_CURSOR_NATIVE_SMOKE==='authorized-paid-native-requests';
it.skipIf(!enabled)('authorized copied native SDK authenticates, reads a disposable file, follows up, cancels and reconnects same store',async()=>{
 const file=process.env.SPECOPS_CURSOR_NATIVE_KEY_FILE,model=process.env.SPECOPS_CURSOR_NATIVE_MODEL;
 if(!file||!isAbsolute(file)||!model)throw new Error('Set an explicit absolute private key file and native catalog model ID');
 const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));let key:string;
 try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>8192||(process.platform!=='win32'&&stat.mode&0o077))throw new Error('Key file must be private and bounded');key=new TextDecoder('utf8',{fatal:true}).decode(readFileSync(fd)).trim();if(!key)throw new Error('Key file is empty');}finally{closeSync(fd);}
 const root=mkdtempSync(join(tmpdir(),'specops-cursor-authorized-')),workspace=join(root,'workspace'),assets=join(root,'cursor');mkdirSync(workspace,{mode:0o700});writeFileSync(join(workspace,'sample.txt'),'Native smoke fixture 42\n',{mode:0o600});cpSync(resolve('dist/cursor'),assets,{recursive:true});
 const options={profileRoot:join(root,'profiles'),assets:()=>verifyCursorAssetDirectory(assets),turnTimeoutMs:60000};let a=new CursorRuntimeAdapter(options);
 try{const p=a.store.create('Authorized native smoke');a.store.saveKey(p.id,key!);await a.refresh(p.id);expect((await a.listModels({connectionProfileId:p.id})).some(m=>m.id===model)).toBe(true);
 const native=await a.createSession({runtimeId:'cursor',connectionProfileId:p.id,workspaceRootPath:workspace,modelId:model,modeId:'agent',runtimeMetadata:{toolset:'files-read',sandbox:'enabled'}});
 const send=(prompt:string,id:string)=>({native,workspaceRootPath:workspace,prompt,turnId:asSpecOpsTurnId(id),context:{clientUserMessageId:id}});
 const first=await collectContractEvents(a.send(send('Read sample.txt and report its number. Do not inspect other files.','first')));expect(first.at(-1)?.type).toBe('turn.finished');expect(first.some(e=>e.type==='tool.completed')).toBe(true);expect(readFileSync(join(workspace,'sample.txt'),'utf8')).toBe('Native smoke fixture 42\n');
 expect((await collectContractEvents(a.send(send('What number did the previous file contain? Reply briefly.','followup')))).at(-1)?.type).toBe('turn.finished');
 const iterator=a.send(send('Read sample.txt and write a detailed explanation of its number.','cancel'))[Symbol.asyncIterator]();let result=await iterator.next();while(!result.done&&!result.value.nativeTurnId)result=await iterator.next();expect(result.done).toBe(false);await a.cancel({native});const rest=[];for(result=await iterator.next();!result.done;result=await iterator.next())rest.push(result.value);expect(rest.at(-1)?.type).toBe('turn.cancelled');
 await a.close();a=new CursorRuntimeAdapter(options);await a.refresh(p.id);const recovered=await a.resumeSession({native,workspaceRootPath:workspace});expect(recovered.nativeSessionId).toBe(native.nativeSessionId);const users=recovered.history?.filter(m=>m.role==='user').map(m=>m.id);expect(users).toHaveLength(3);expect(users).toEqual(expect.arrayContaining(['first','followup','cancel']));expect(JSON.stringify({first,recovered})).not.toContain(key!);
 }finally{await a.close();rmSync(root,{recursive:true,force:true});}
},180000);
