// No-account source artifact probe. Invoked only with an explicit external extracted root.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(process.argv[2]);
const home = join(root, 'private-probe');
mkdirSync(join(home,'native'), {recursive:true, mode:0o700});
const env = {HOME:home, USERPROFILE:home, XDG_CONFIG_HOME:home, CLAUDE_CONFIG_DIR:home, PATH:'/usr/bin:/bin', DISABLE_AUTOUPDATER:'1'};
const node = join(root,'node/node');
const run = (binary, args, input, timeout=15000) => {
  const result = spawnSync(binary,args,{cwd:root,env,input,encoding:'utf8',timeout,maxBuffer:1024*1024});
  if (result.error || result.status !== 0) throw new Error('Source artifact control probe failed');
  return result.stdout;
};
if (run(node,['--version']).trim() !== 'v24.15.0') throw new Error('Node pin mismatch');
const claude = join(root,'claude');
if (!run(join(claude,'claude'),['--version']).startsWith('2.1.289 ')) throw new Error('Native pin mismatch');
const models = run(node,['--input-type=module','-e',`
  import {pathToFileURL} from 'node:url';
  const {query}=await import(pathToFileURL(process.argv[1]).href);
  const abort=new AbortController();
  async function* input(){await new Promise(resolve=>abort.signal.addEventListener('abort',resolve,{once:true}));}
  const q=query({prompt:input(),options:{env:process.env,cwd:process.env.HOME,pathToClaudeCodeExecutable:process.argv[2],abortController:abort,settingSources:[],tools:[],persistSession:false}});
  const timer=setTimeout(()=>{abort.abort();q.close();process.exitCode=1},10000);
  try{const models=await q.supportedModels();if(!models.length)throw new Error('Empty catalog');console.log(JSON.stringify({models:models.length}))}
  finally{clearTimeout(timer);abort.abort();q.close()}
`,join(claude,'sdk.mjs'),join(claude,'claude')]);
if (!JSON.parse(models).models) throw new Error('Native catalog unavailable');
const cursor=join(root,'cursor');
const sdk=join(cursor,'node_modules/@cursor/sdk/dist/esm/index.js');
const probe=JSON.parse(run(node,[join(cursor,'worker.mjs')],JSON.stringify({sdk,action:'probe'})));
if (!probe.probe?.durableAgent) throw new Error('Local SDK create/resume/dispose failed');
const bin=join(cursor,'node_modules/@cursor/sdk-darwin-arm64/bin');
if (!run(join(bin,'rg'),['--version']).startsWith('ripgrep ')) throw new Error('Search helper unavailable');
const sandbox=spawnSync(join(bin,'cursorsandbox'),['--help'],{cwd:root,env,timeout:3000,encoding:'utf8',maxBuffer:16384});
if (sandbox.error) throw new Error('Sandbox helper unavailable');
const versions={node:'24.15.0',claudeSdk:'0.3.289',claudeNative:'2.1.289',cursor:'1.0.35'};
if (process.argv.includes('--native')) {
 if (!run(join(root,'codex/bin/codex'),['--version']).trim().endsWith('0.160.0')) throw new Error('Native component pin mismatch');
 if (run(join(root,'opencode/opencode'),['--version']).trim() !== '1.17.4') throw new Error('Native component pin mismatch');
 versions.codex='0.160.0';versions.opencode='1.17.4';
}
console.log(JSON.stringify({target:'darwin-arm64',versions,sharedNode:true,copiedSdkControl:true,cursorLocalStore:true,nativeHelpers:true,developerPathAbsent:true,accounts:false,inference:false,signedInstalledApp:false,sandboxEnforcement:'not-run'}));
