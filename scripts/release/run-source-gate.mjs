// Account-free source regression only. Credentials and paid smoke opt-ins are removed.
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error('Supply an absolute output directory outside the checkout');
if (output === root || output.startsWith(root + '/')) throw new Error('Gate output must be outside the checkout');
const resolvedRoot = realpathSync(root);
const resolvedParent = realpathSync(dirname(output));
if (resolvedParent === resolvedRoot || resolvedParent.startsWith(resolvedRoot + '/')) throw new Error('Gate output resolves inside checkout');
mkdirSync(output, {mode:0o700});
const env = {...process.env};
for (const key of Object.keys(env)) if (/KEY|TOKEN|SECRET|PASSWORD|SPECOPS_|NODE_OPTIONS|NODE_PATH/i.test(key)) delete env[key];
const steps = [
  ['host-check','app/host',['npm','run','check']],
  ['host-build','app/host',['npm','run','build']],
  ['host-tests','app/host',['npm','test','--','--fileParallelism=false']],
  ['frontend-check','app',['npm','run','check']],
  ['frontend-build','app',['npm','run','build']],
  ['frontend-tests','app',['npm','test']],
  ['rust-tests','app/src-tauri',['cargo','test']],
  ['claude-copied-assets','app/host',[process.execPath,'scripts/probe-claude.mjs']],
  ['cursor-copied-assets','app/host',[process.execPath,'scripts/probe-cursor.mjs']],
  ['record-validator-tests','.',[process.execPath,'--test','scripts/release/check-record.test.mjs']],
];
const results=[];
for (const [id,cwd,[command,...args]] of steps) {
  console.log(`Running ${id}`);
  const result=spawnSync(command,args,{cwd:join(root,cwd),env,encoding:'utf8',timeout:600000,maxBuffer:32*1024*1024});
  writeFileSync(join(output,`${id}.log`),(result.stdout??'')+(result.stderr??'')+(result.error?`\n${result.error.code}\n`:''),{mode:0o600});
  results.push({id,status:result.status===0&&!result.error?'pass':'fail',exitCode:result.status,log:`${id}.log`});
}
const workingTreeDirty=Boolean(spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).stdout.trim());
const commit=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
writeFileSync(join(output,'source-results.json'),JSON.stringify({schemaVersion:1,recordedAt:new Date().toISOString(),sourceCommit:commit,workingTreeDirty,node:process.version,platform:process.platform,arch:process.arch,results,recommendation:'blocked',note:'Source-only run; installed/account/distribution/platform/process acceptance must be recorded separately.'},null,2)+'\n',{mode:0o600});
console.log(`Results: ${join(output,'source-results.json')}`);
if(results.some(r=>r.status==='fail')) process.exitCode=1;
