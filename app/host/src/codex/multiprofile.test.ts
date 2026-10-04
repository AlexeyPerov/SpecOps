import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexRuntimeAdapter } from './adapter';
import { isolatedEnvironment } from './profiles';
import { threadFixture } from './threadFixtures';
import { collectContractEvents } from '../../../src/lib/session/adapter/adapter.contract';
import { asSpecOpsTurnId } from '../../../src/lib/session/ids';
import type { NativeSessionRef } from '../../../src/lib/session/adapter';
const cleanup: (()=>void)[]=[];
afterEach(()=>cleanup.splice(0).reverse().forEach(close=>close()));
function setup() {
 const root=mkdtempSync(join(tmpdir(),'specops-profiles-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const executable=join(root,'native.cjs');writeFileSync(executable,threadFixture,{mode:0o700});
 const options={profileRoot:join(root,'profiles'),executable,experimental:true};
 const adapter=new CodexRuntimeAdapter(options);cleanup.push(()=>adapter.close());return {root,options,adapter};
}
const request=(native:NativeSessionRef,workspace:string,prompt='hello')=>({native,workspaceRootPath:workspace,prompt,turnId:asSpecOpsTurnId('turn-'+native.connectionProfileId)});
it('two real native fixture processes isolate equal IDs, native homes/config, quota, Stop, child crash, generations and restart',async()=>{
 const {root,adapter}=setup(); const a=adapter.store.create('First');const b=adapter.store.create('Second');
 const [nativeA,nativeB]=await Promise.all([a,b].map(profile=>adapter.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:root})));
 expect(nativeA.nativeSessionId).toBe(nativeB.nativeSessionId);
 const [ca,cb]=await Promise.all([adapter.connect(a.id),adapter.connect(b.id)]);
 const ea=await ca.transport!.request('fixture/env') as {pid:number;env:Record<string,string>};const eb=await cb.transport!.request('fixture/env') as typeof ea;
 expect(ea.pid).not.toBe(eb.pid);expect(ea.env.HOME).toBe(adapter.store.home(a.id));expect(eb.env.HOME).toBe(adapter.store.home(b.id));
 writeFileSync(join(adapter.store.home(a.id),'config.toml'),'profile-first-MCP-and-skills-canary');expect(readFileSync(join(adapter.store.home(b.id),'config.toml'),'utf8')).not.toContain('first');
 const first=adapter.send(request(nativeA,root,'cancel'))[Symbol.asyncIterator]();await first.next();await new Promise(resolve=>setTimeout(resolve,30));
 const second=collectContractEvents(adapter.send(request(nativeB,root)));await adapter.cancel({native:nativeA});
 const cancelled=[];for(let value=await first.next();!value.done;value=await first.next())cancelled.push(value.value);
 expect(cancelled.at(-1)?.type).toBe('turn.cancelled');expect((await second).at(-1)?.type).toBe('turn.finished');
 ca.transport!.onNotification('account/rateLimits/updated',{accountId:'first',ordinaryUsageAllowed:false,rateLimits:{limitId:'coding',rateLimitReachedType:'rate_limit_reached'}},ca.transport!.generation);
 expect(ca.snapshot.recovery).toBe('quota');expect(cb.snapshot.recovery).not.toBe('quota');
 await expect(collectContractEvents(adapter.send(request(nativeA,root)))).rejects.toThrow('Usage limit');
 expect((await collectContractEvents(adapter.send(request(nativeB,root)))).at(-1)?.type).toBe('turn.finished');
 const crashed=await collectContractEvents(adapter.send(request(nativeA,root,'child-failure'))).catch(error=>error); // Quota remains profile-local until native explicit recovery.
 expect(String(crashed)).toContain('Usage limit');
 ca.transport!.onNotification('account/rateLimits/updated',{ordinaryUsageAllowed:true},ca.transport!.generation);await adapter.authenticate({runtimeId:'codex',connectionProfileId:a.id,workspaceRootPath:root,options:{action:'read'}});
 expect((await collectContractEvents(adapter.send(request(nativeA,root,'child-failure')))).at(-1)?.type).toBe('turn.failed');
 expect(cb.transport!.running).toBe(true);expect((await collectContractEvents(adapter.send(request(nativeB,root)))).at(-1)?.type).toBe('turn.finished');
 const generation=ca.snapshot.generation;await adapter.resumeSession({native:nativeA,workspaceRootPath:root});expect(ca.snapshot.generation).toBeGreaterThan(generation);
 ca.transport!.onNotification('account/rateLimits/updated',{ordinaryUsageAllowed:false},generation);expect(ca.snapshot.usage?.ordinaryUsageAllowed).not.toBe(false);
});
it('rename retains stable binding; logout and removal preserve native history/workspace and leave sibling usable',async()=>{
 const {root,adapter}=setup();const a=adapter.store.create('Original');const b=adapter.store.create('Sibling');
 const [na,nb]=await Promise.all([a,b].map(profile=>adapter.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:root})));
 await Promise.all([na,nb].map(native=>collectContractEvents(adapter.send(request(native,root)))));
 const auth=(id:string,action:string,label?:string)=>adapter.authenticate({runtimeId:'codex',connectionProfileId:id,workspaceRootPath:root,options:{action,label}});
 expect((await auth(a.id,'rename-profile','Renamed')).profile).toMatchObject({id:a.id,label:'Renamed'});
 const originalKey=JSON.parse(readFileSync(join(adapter.store.home(a.id),'auth.json'),'utf8')).OPENAI_API_KEY;
 await auth(a.id,'logout'); expect(existsSync(join(adapter.store.home(a.id),'fixture-history.json'))).toBe(true);
 writeFileSync(join(adapter.store.home(a.id),'api-key'),originalKey,{mode:0o600});await adapter.authenticate({runtimeId:'codex',connectionProfileId:a.id,workspaceRootPath:root,options:{action:'login-api-key'},credential:{kind:'api-key',ref:'profile-api-key'}});
 expect((await adapter.resumeSession({native:na,workspaceRootPath:root})).history?.filter(m=>m.role==='user')).toHaveLength(1);
 const oldConnection=await adapter.connect(a.id);const oldTransport=oldConnection.transport!;const snapshots:string[]=[];adapter.onAuthUpdate=update=>{if(update.connectionProfileId===a.id)snapshots.push(update.profile.state);};
 expect((await auth(a.id,'remove-profile')).profile?.state).toBe('missing-profile'); oldTransport.onExit(oldTransport.generation);oldTransport.onNotification('account/updated',{authMode:'apikey',planType:null},oldTransport.generation);expect(snapshots.at(-1)).toBe('missing-profile');expect(oldConnection.snapshot.state).toBe('missing-profile');expect(adapter.store.list().map(p=>p.id)).toEqual([b.id]);
 expect(existsSync(join(root,'profiles',a.id,'home','fixture-history.json'))).toBe(true);expect(existsSync(join(root,'profiles',a.id,'home','auth.json'))).toBe(false);
 await expect(adapter.resumeSession({native:na,workspaceRootPath:root})).rejects.toMatchObject({code:'session-not-found'});
 expect((await collectContractEvents(adapter.send(request(nb,root)))).at(-1)?.type).toBe('turn.finished');
});
it('durable account principal prevents cross-account native resume after a fresh host, and original identity can resume',async()=>{
 const {root,options,adapter}=setup();const profile=adapter.store.create('Bound');const native=await adapter.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:root});
 await collectContractEvents(adapter.send(request(native,root)));const path=join(adapter.store.home(profile.id),'auth.json');const original=readFileSync(path,'utf8');adapter.close();writeFileSync(path,JSON.stringify({OPENAI_API_KEY:'DIFFERENT-ACCOUNT-KEY-CANARY'}));
 const fresh=new CodexRuntimeAdapter(options);cleanup.push(()=>fresh.close());
 await expect(fresh.resumeSession({native,workspaceRootPath:root})).rejects.toThrow('account binding mismatch');
 const log=readFileSync(join(fresh.store.home(profile.id),'fixture-requests.jsonl'),'utf8');expect(log.match(/thread\/resume/g)).toBeNull();expect(log).not.toContain('DIFFERENT-ACCOUNT');
 fresh.close();writeFileSync(path,original);expect((await fresh.resumeSession({native,workspaceRootPath:root})).history?.find(m=>m.role==='user')?.content).toBe('hello');
});
it('unknown principals, malformed/oversized/symlink auth fail closed; rotating ChatGPT tokens retain stable account ID',()=>{
 const {adapter}=setup();const profile=adapter.store.create('Identity');const store=adapter.store;const path=join(store.home(profile.id),'auth.json');
 expect(()=>store.identity(profile.id,{type:'apiKey'})).toThrow('Stable native');
 writeFileSync(path,JSON.stringify({tokens:{account_id:'account-canary',access_token:'old'}}));const principal=store.identity(profile.id,{type:'chatgpt',email:'email-canary'});
 writeFileSync(path,JSON.stringify({tokens:{account_id:'account-canary',access_token:'new'}}));expect(store.identity(profile.id,{type:'chatgpt'})).toBe(principal);
 writeFileSync(path,'x'.repeat(1024*1024+1));expect(()=>store.identity(profile.id,{type:'apiKey'})).toThrow();rmSync(path);symlinkSync('/nonexistent',path);expect(()=>store.identity(profile.id,{type:'apiKey'})).toThrow();
});
it('ordinary tool environment is finite and all ambient runtime/auth/config injection canaries are absent',()=>{
 const ambient:NodeJS.ProcessEnv={PATH:'/tools',LANG:'en_US.UTF-8',HOME:'/desktop',XDG_CONFIG_HOME:'/desktop/config',NODE_OPTIONS:'INJECTION-CANARY',HTTP_PROXY:'PROXY-CANARY'};
 for(const key of ['OPENAI_API_KEY','ANTHROPIC_AUTH_TOKEN','OPENCODE_CONFIG_CONTENT','CURSOR_API_KEY','GEMINI_API_KEY','GOOGLE_APPLICATION_CREDENTIALS','AWS_PROFILE','CHATGPT_TOKEN','CODEX_HOME','SSH_AUTH_SOCK','NPM_CONFIG_USERCONFIG'])ambient[key]='SECRET-CANARY';
 const env=isolatedEnvironment('/profile',ambient);expect(JSON.stringify(env)).not.toMatch(/CANARY|desktop/);expect(env).toMatchObject({PATH:'/tools',LANG:'en_US.UTF-8',HOME:'/profile',CODEX_HOME:'/profile'});
});
it('authentication reserves owner before awaits and retires active work; unsupported actions never touch processes',async()=>{
 const {root,adapter}=setup();const a=adapter.store.create('Owner');const b=adapter.store.create('Sibling');
 const [na,nb]=await Promise.all([a,b].map(profile=>adapter.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:root})));
 const ca=await adapter.connect(a.id);const initialGeneration=ca.transport!.generation;
 await expect(adapter.authenticate({runtimeId:'codex',connectionProfileId:a.id,workspaceRootPath:root,options:{action:'unknown'}})).rejects.toThrow('Unsupported');expect(ca.transport!.generation).toBe(initialGeneration);expect(ca.transport!.running).toBe(true);expect(ca.snapshot.state).toBe('authenticated');
 const active=adapter.send(request(na,root,'cancel'))[Symbol.asyncIterator]();await active.next();await new Promise(resolve=>setTimeout(resolve,30));
 let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const reached=new Promise<void>(resolve=>{entered=resolve;});
 const original=ca.transport!.request.bind(ca.transport!);ca.transport!.request=async(method,params,timeout)=>{const result=await original(method,params,timeout);if(method==='account/login/start'){entered();await waiting;}return result;};
 writeFileSync(join(adapter.store.home(a.id),'api-key'),'new-owner-key-canary',{mode:0o600});
 const login=adapter.authenticate({runtimeId:'codex',connectionProfileId:a.id,workspaceRootPath:root,options:{action:'login-api-key'},credential:{kind:'api-key',ref:'profile-api-key'}});await reached;
 const events=[];for(let next=await active.next();!next.done;next=await active.next())events.push(next.value);expect(events.at(-1)?.type).toBe('turn.failed');
 await expect(adapter.resumeSession({native:na,workspaceRootPath:root})).rejects.toThrow('authentication is busy');await expect(adapter.createSession({runtimeId:'codex',connectionProfileId:a.id,workspaceRootPath:root})).rejects.toThrow('authentication is busy');
 expect((await collectContractEvents(adapter.send(request(nb,root)))).at(-1)?.type).toBe('turn.finished');release();await login;
 await expect(adapter.resumeSession({native:na,workspaceRootPath:root})).rejects.toThrow('account binding mismatch');
});
