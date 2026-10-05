import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexRuntimeAdapter } from './adapter';
import { ecosystemFixture } from './ecosystemFixtures';
import { NativeEcosystem } from './ecosystem';
import { asSpecOpsTurnId } from '../../../src/lib/session/ids';
const cleanup: (()=>void)[]=[]; afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));
async function setup() {
 const root=mkdtempSync(join(tmpdir(),'specops-ecosystem-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const executable=join(root,'fixture.cjs');writeFileSync(executable,ecosystemFixture,{mode:0o700});
 const adapter=new CodexRuntimeAdapter({executable,profileRoot:join(root,'profiles'),experimental:true});cleanup.push(()=>adapter.close());
 const profile=adapter.store.create('A');const native=await adapter.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:root});
 return {root,adapter,profile,native,input:{native,workspaceRootPath:root}, requests:()=>readFileSync(join(adapter.store.home(profile.id),'fixture-requests.jsonl'),'utf8')};
}
it('catalog controls change only the selected native profile and survive fresh native resume; secrets never project',async()=>{
 const {adapter,root,input,profile,requests}=await setup();
 const other=adapter.store.create('B');const b=await adapter.createSession({runtimeId:'codex',connectionProfileId:other.id,workspaceRootPath:root});
 const view=await adapter.inspectNative({...input,view:'ecosystem'});expect(JSON.stringify(view)).not.toContain('SECRET-');expect(JSON.stringify(view)).not.toContain('OPAQUE-');expect(view.rows.find(r=>r.control)?.control?.value).toBe('true');
 const skill=view.rows.find(r=>r.control)!.id;await adapter.actNative({...input,action:'setSkillEnabled',target:skill,value:'false'});
 await expect(adapter.actNative({...input,action:'setSkillEnabled',target:skill,value:'true'})).rejects.toThrow('refresh');
 let refreshed=await adapter.inspectNative({...input,view:'ecosystem'});expect(refreshed.rows.find(r=>r.control)?.control?.value).toBe('false');
 const server=refreshed.rows.find(r=>r.targetKind==='toolServer')!.id;await adapter.actNative({...input,action:'disconnectToolServer',target:server});
 refreshed=await adapter.inspectNative({...input,view:'ecosystem'});expect(refreshed.rows.find(r=>r.targetKind==='toolServer')?.detail).toContain('Disabled');expect(requests()).toContain('config/mcpServer/reload');await adapter.actNative({...input,action:'connectToolServer',target:refreshed.rows.find(r=>r.targetKind==='toolServer')!.id});expect((await adapter.inspectNative({...input,view:'ecosystem'})).rows.find(r=>r.targetKind==='toolServer')?.detail).toContain('connected');
 const bView=await adapter.inspectNative({native:b,workspaceRootPath:root,view:'ecosystem'});expect(bView.rows.find(r=>r.control)?.control?.value).toBe('true');expect(bView.rows.find(r=>r.targetKind==='toolServer')?.detail).toContain('connected');
 const config=await adapter.inspectNative({...input,view:'configuration'});expect(JSON.stringify(config)).not.toContain('SECRET-');expect(config.rows).toHaveLength(3);
 const setting=config.rows.find(r=>r.label==='web search')!;await adapter.actNative({...input,action:'setNativeConfig',target:setting.id,value:'disabled'});
 adapter.close();await adapter.resumeSession(input);expect((await adapter.inspectNative({...input,view:'configuration'})).rows.find(r=>r.label==='web search')?.control?.value).toBe('disabled');expect(adapter.store.home(profile.id)).not.toBe(adapter.store.home(other.id));
});
it('rejects cross-profile, forged, expired-generation, stale-version and invalid values before writes; blocks active profile turns',async()=>{
 const {adapter,root,input,profile,requests}=await setup(); const config=await adapter.inspectNative({...input,view:'configuration'});const id=config.rows[0]!.id;
 const before=requests();await expect(adapter.actNative({...input,action:'setNativeConfig',target:'../../../global',value:'live'})).rejects.toThrow();await expect(adapter.actNative({...input,action:'setNativeConfig',target:id,value:'arbitrary'})).rejects.toThrow();expect(requests()).toBe(before);
 const other=adapter.store.create('B');const b=await adapter.createSession({runtimeId:'codex',connectionProfileId:other.id,workspaceRootPath:root});await expect(adapter.actNative({native:b,workspaceRootPath:root,action:'setNativeConfig',target:id,value:'live'})).rejects.toThrow();
 const path=join(adapter.store.home(profile.id),'fixture-config.json');const stored=JSON.parse(readFileSync(path,'utf8'));stored.version='v20';writeFileSync(path,JSON.stringify(stored));
 adapter.close();await adapter.resumeSession(input);await expect(adapter.actNative({...input,action:'setNativeConfig',target:id,value:'live'})).rejects.toThrow();expect(requests()).not.toContain('config/value/write');
 const current=await adapter.inspectNative({...input,view:'configuration'});const iter=adapter.send({...input,prompt:'cancel',turnId:asSpecOpsTurnId('active')})[Symbol.asyncIterator]();await iter.next();await expect(adapter.actNative({...input,action:'setNativeConfig',target:current.rows[0]!.id,value:'live'})).rejects.toThrow();await adapter.cancel({native:input.native});await iter.return?.();
});
it('native CAS and ambiguous control acknowledgments consume the token without replay or arbitrary path forwarding',async()=>{
 const ecosystem=new NativeEcosystem();const writes:unknown[]=[];let reject=false;const context={key:'profile/thread',generation:1,home:'/private/home',cwd:'/workspace',threadId:'thread',check(){},safe:(s:string,n:number)=>s.slice(0,n),async request(method:string,params:unknown){if(method==='config/read')return {config:{web_search:'cached'},layers:[{name:{type:'user',file:'/private/home/config.toml',profile:null},version:'one',config:{},disabledReason:null}]};writes.push({method,params});if(reject)throw new Error('lost acknowledgment');return {status:'ok',filePath:'/private/home/config.toml',version:'two'};}};
 const view=await ecosystem.inspect(context,'configuration');const target=view.rows[0]!.id;reject=true;await expect(ecosystem.act(context,'setNativeConfig',target,'live')).rejects.toThrow();await expect(ecosystem.act(context,'setNativeConfig',target,'cached')).rejects.toThrow('Refresh');expect(writes).toEqual([{method:'config/value/write',params:{keyPath:'web_search',value:'live',mergeStrategy:'replace',filePath:'/private/home/config.toml',expectedVersion:'one'}}]);
});
it('rejects malformed or unbounded MCP pagination without leaking raw native metadata',async()=>{
 const ecosystem=new NativeEcosystem();const c={key:'k',generation:1,home:'/h',cwd:'/w',threadId:'t',check(){},safe:(s:string,n:number)=>s.slice(0,n),async request(method:string){if(method==='skills/list')return {data:[{cwd:'/w',skills:[]}]};if(method==='config/read')return {config:{},layers:[{name:{type:'user',file:'/h/config.toml',profile:null},version:'v',config:{},disabledReason:null}]};return {data:[],nextCursor:'same'};}};await expect(ecosystem.inspect(c,'ecosystem')).rejects.toThrow('pagination');
});

it('profile configuration symlink fails before either native skill or native config writes',async()=>{
 const {adapter,input,profile,root,requests}=await setup();const ecosystem=await adapter.inspectNative({...input,view:'ecosystem'});const config=await adapter.inspectNative({...input,view:'configuration'});const before=requests();
 const path=join(adapter.store.home(profile.id),'config.toml');const outside=join(root,'outside.toml');writeFileSync(outside,'unchanged');unlinkSync(path);symlinkSync(outside,path);
 await expect(adapter.actNative({...input,action:'setSkillEnabled',target:ecosystem.rows.find(r=>r.control)!.id,value:'false'})).rejects.toThrow();await expect(adapter.actNative({...input,action:'setNativeConfig',target:config.rows[0]!.id,value:'live'})).rejects.toThrow();expect(requests()).toBe(before);expect(readFileSync(outside,'utf8')).toBe('unchanged');
});

it('catalog permissions are tied to the owning transport even when native generation is reused',async()=>{
 const {adapter,input,profile,requests}=await setup();const view=await adapter.inspectNative({...input,view:'configuration'});const before=requests();
 await adapter.authenticate({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:'',options:{action:'experimental-off'}});await adapter.authenticate({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:'',options:{action:'experimental-on'}});await adapter.resumeSession(input);
 await expect(adapter.actNative({...input,action:'setNativeConfig',target:view.rows[0]!.id,value:'live'})).rejects.toThrow();expect(requests().slice(before.length)).not.toContain('config/value/write');
});

it('CAS version changes in the same native process fail before mutation and cached OAuth secrets stay private',async()=>{
 const {adapter,input,profile,requests}=await setup();const home=adapter.store.home(profile.id);writeFileSync(join(home,'.credentials.json'),JSON.stringify({local:{tokens:{access_token:'OPAQUE-NATIVE-OAUTH-CANARY'}}}),{mode:0o600});expect(adapter.store.mcpCredentialValues(profile.id)).toContain('OPAQUE-NATIVE-OAUTH-CANARY');expect(JSON.stringify(await adapter.inspectNative({...input,view:'ecosystem'}))).not.toContain('OPAQUE-NATIVE-OAUTH-CANARY');
 const view=await adapter.inspectNative({...input,view:'configuration'});const connection=await adapter.connect(profile.id);await connection.transport!.request('config/value/write',{keyPath:'web_search',value:'disabled',mergeStrategy:'replace',filePath:realpathSync(join(home,'config.toml')),expectedVersion:'v1'});const before=requests();
 await expect(adapter.actNative({...input,action:'setNativeConfig',target:view.rows[0]!.id,value:'live'})).rejects.toThrow();expect(requests().slice(before.length)).not.toContain('config/value/write');writeFileSync(join(home,'.credentials.json'),'{MALFORMED-PRIVATE-OAUTH-CANARY');expect(()=>adapter.store.mcpCredentialValues(profile.id)).toThrow('Native credential storage is unreadable');
});

import { CodexTransport, resolveCodexExecutable, object } from './transport';
it.skipIf(!resolveCodexExecutable())('installed pinned native config honors private file OAuth storage and versioned writes without authentication or inference', async () => {
  const root=mkdtempSync(join(tmpdir(),'specops-native-configuration-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const adapter=new CodexRuntimeAdapter({profileRoot:join(root,'profiles')});cleanup.push(()=>adapter.close());const profile=adapter.store.create('No account');const home=realpathSync(adapter.store.home(profile.id));
  const transport=new CodexTransport(resolveCodexExecutable()!,home,{PATH:process.env.PATH,HOME:'/unrelated/desktop',CODEX_HOME:'/unrelated/desktop',OPENAI_API_KEY:'EXCLUDED-PROBE-KEY'},true);cleanup.push(()=>transport.close());await transport.start();
  const raw=await transport.request('config/read',{cwd:home,includeLayers:true});expect(object(raw)&&object(raw.config)&&raw.config.mcp_oauth_credentials_store).toBe('file');
  if(!object(raw)||!Array.isArray(raw.layers))throw new Error('Native layers absent');const layer=raw.layers.find(v=>object(v)&&object(v.name)&&v.name.type==='user');if(!object(layer)||!object(layer.name))throw new Error('Private user layer absent');expect(layer.name.file).toBe(join(home,'config.toml'));
  const write=await transport.request('config/value/write',{keyPath:'web_search',value:'disabled',mergeStrategy:'replace',filePath:join(home,'config.toml'),expectedVersion:layer.version});expect(write).toMatchObject({status:'ok',filePath:join(home,'config.toml')});
  expect(await transport.request('config/read',{cwd:home,includeLayers:false})).toMatchObject({config:{web_search:'disabled',mcp_oauth_credentials_store:'file'}});
  await expect(transport.request('config/value/write',{keyPath:'web_search',value:'live',mergeStrategy:'replace',filePath:join(home,'config.toml'),expectedVersion:layer.version})).rejects.toThrow();expect(adapter.store.mcpCredentialValues(profile.id)).toEqual([]);
});
