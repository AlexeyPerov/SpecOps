/** No-account source control probe, built by CI and run with copied components outside checkout. */
import { readFileSync, mkdirSync, realpathSync, existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { bindManagedComponent, managedEntry } from '../src/componentRuntime';
import { CodexTransport, resolveCodexExecutable, object } from '../src/codex/transport';
import { ProfileStore } from '../src/codex/profiles';
import { RuntimeProfileStore } from '../src/opencode/profiles';
import { RuntimeConnection, resolveExecutable } from '../src/opencode/lifecycle';
import { resolveClaudeAssets, probeClaudeSdk } from '../src/claude/runtime';
import { nativeCursorDriver } from '../src/cursor/session';
import { AdapterRegistry } from '../src/registry';
import { createFakeRuntimeAdapter } from '../../src/lib/session/adapter/fake';
import { resolveCursorAssets, cursorControl } from '../src/cursor/runtime';
const root = realpathSync(process.argv[2]);
const manifests = JSON.parse(readFileSync(join(root, 'manifests.json'), 'utf8'));
const rootsFile=join(root,'manifest-roots.json');
const roots=existsSync(rootsFile)?JSON.parse(readFileSync(rootsFile,'utf8')):{};
process.env.SPECOPS_MANAGED_COMPONENTS = '1';
for (const manifest of manifests.filter((m: {id:string}) => m.id !== 'node')) bindManagedComponent({root:roots[manifest.id] ?? join(root,manifest.id),manifest});
const home = join(root,'managed-profiles'); mkdirSync(home, {mode:0o700});
const env = {HOME:home,PATH:'/usr/bin:/bin',DISABLE_AUTOUPDATER:'1'};
const codexStore = new ProfileStore(join(home,'codex'));
const a=codexStore.create('A'), b=codexStore.create('B');
const codex = new CodexTransport(resolveCodexExecutable()!,codexStore.home(a.id),env,true);
try {
 await codex.start();
 const config=await codex.request('config/read',{cwd:codexStore.home(a.id),includeLayers:true});
 if (!object(config) || !object(config.config) || config.config.mcp_oauth_credentials_store !== 'file') throw new Error('Native private configuration failed');
 const auth=await codex.request('account/read',{refreshToken:false});
 if (!object(auth) || auth.account !== null) throw new Error('No-account native control failed');
 if(codexStore.home(a.id)===codexStore.home(b.id)) throw new Error('Private profile isolation failed');
} finally {codex.close();}
const store = new RuntimeProfileStore(join(home,'opencode'));
const profile = store.create('No account');
const connection=new RuntimeConnection(profile,store,resolveExecutable(),env);
try {await connection.start(); if(!connection.client) throw new Error('Managed native server failed');}
finally {connection.close();}
const claudeHome=join(home,'claude');mkdirSync(claudeHome,{mode:0o700});
const models=await probeClaudeSdk(resolveClaudeAssets(),{...env,HOME:claudeHome,CLAUDE_CONFIG_DIR:claudeHome});
if (!models.length) throw new Error('Managed SDK control failed');
const cursorHome=join(home,'cursor');mkdirSync(join(cursorHome,'native'),{recursive:true,mode:0o700});
const cursor=await cursorControl(resolveCursorAssets(),{...env,HOME:cursorHome},'probe');
if(!cursor.probe?.durableAgent) throw new Error('Managed create/resume/dispose failed');
const sessionStore=join(cursorHome,'native','session-store');mkdirSync(sessionStore,{mode:0o700});
const driver=nativeCursorDriver(resolveCursorAssets(),{...env,HOME:cursorHome},15000);
const request={store:sessionStore,cwd:root,key:'specops-no-account-probe',binding:{scope:'managed-source-probe'}};
let agentId='';
for await (const frame of driver.operation({...request,action:'create'},new AbortController().signal)) {if(frame.type==='created') agentId=frame.agentId;}
if(!agentId.startsWith('agent-')) throw new Error('Managed session worker create failed');
let historyDone=false;
for await (const frame of driver.operation({...request,action:'history',agentId},new AbortController().signal)) {if(frame.type==='historyDone') historyDone=true;}
if(!historyDone) throw new Error('Managed session worker resume failed');
await driver.stop?.();
if(!managedEntry('cursor','search') || !managedEntry('cursor','sandbox')) throw new Error('Managed helper graph failed');
const fixtureRegistry=new AdapterRegistry();
fixtureRegistry.registerLazy('fake',async()=>{if(!managedEntry('codex')) throw new Error('Fixture managed dependency missing');return createFakeRuntimeAdapter({turns:{}})});
await fixtureRegistry.activate('fake');
if((await fixtureRegistry.discovery())[0]?.id!=='fake') throw new Error('Fixture descriptor contract failed');
// Account-free source cost measurement of the exact copied/native-installed roots.
function allocatedBytes(directory: string): number {
 if (!existsSync(directory)) return 0;
 const pending=[directory];let bytes=0,count=0;
 while(pending.length){const path=pending.pop()!;const stat=lstatSync(path);if(++count>120000 || stat.isSymbolicLink() || (!stat.isFile()&&!stat.isDirectory()))throw new Error('Unexpected source measurement tree');bytes+=stat.blocks*512;if(stat.isDirectory())for(const name of readdirSync(path))pending.push(join(path,name));}
 return bytes;
}
const componentAllocatedBytes=Object.fromEntries(manifests.map((manifest: {id:string})=>[manifest.id,allocatedBytes(roots[manifest.id]??join(root,manifest.id))]));
const allFiveAllocatedBytes=Object.values(componentAllocatedBytes).reduce((sum,value)=>sum+Number(value),0);
console.log(JSON.stringify({componentAllocatedBytes,allFiveAllocatedBytes,archiveCacheAllocatedBytes:allocatedBytes(join(root,'components/cache')),stagingAllocatedBytes:allocatedBytes(join(root,'components/staging')),firstPartyFixtureInstallResolveDescriptor:true,cursorSessionWorkerCreateHistory:true,managedResolvers:true,codexPrivateConfig:true,codexNoAccount:true,opencodePrivateServer:true,claudeModels:models.length,cursorCreateResumeDispose:true,sharedNode:process.version,accountIsolation:'fixture-only',inference:false,signedInstalled:false}));
