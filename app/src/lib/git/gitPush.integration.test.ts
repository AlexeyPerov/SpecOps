import { beforeEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createTempGitRepo, describeIfGitInstalled, type TempGitRepo } from './test/gitTempRepoHarness';
import { resetGitCommandQueueForTests, enqueueGitCommandForRepo } from './gitCommandQueue';
import { executePushPlan, queryPushSources, pushPlanError, type PushPlan } from './gitPush';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (_command: string, { request }: { request: { repoRoot: string; args: string[] } }) => {
  const result = spawnSync('git', request.args, { cwd: request.repoRoot, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } });
  return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr, durationMs: 1 };
}) }));
vi.mock('../services/logging', () => ({ logDiagnostic: vi.fn() }));
beforeEach(() => resetGitCommandQueueForTests());
function commit(repo:TempGitRepo, name:string) { repo.writeFile(name,name);repo.run(['add',name]);repo.run(['commit','-m',name]); }
async function pair(run:(remote:TempGitRepo,local:TempGitRepo)=>Promise<void>) {
 const remote=createTempGitRepo(),local=createTempGitRepo();try { rmSync(`${remote.dir}/.git`,{recursive:true,force:true});remote.run(['init','--bare']);local.run(['checkout','-B','main']);commit(local,'base');local.run(['remote','add','origin',remote.dir]);await run(remote,local); } finally {local.cleanup();remote.cleanup();}
}
async function plan(local:TempGitRepo):Promise<PushPlan> {const sources=await queryPushSources(local.dir);return {remote:'origin',branches:sources.branches.map(b=>({ref:b.ref,sha:b.sha,destination:b.ref,track:false})),tags:[]};}
describeIfGitInstalled('exact push plans against temporary bare remotes',()=>{
 it('pushes one branch to a new name with tracking on, then preserves upstream with tracking off',async()=>pair(async(remote,local)=>{
  const p=await plan(local);p.branches[0].destination='refs/heads/review';p.branches[0].track=true;
  expect((await executePushPlan(local.dir,p)).ok).toBe(true);expect(String(remote.run(['rev-parse','refs/heads/review'])).trim()).toBe(p.branches[0].sha);
  expect(String(local.run(['config','--get','branch.main.merge']))).toContain('refs/heads/review');
  p.branches[0].destination='refs/heads/other';p.branches[0].track=false;expect((await executePushPlan(local.dir,p)).ok).toBe(true);
  expect(String(local.run(['config','--get','branch.main.merge']))).toContain('refs/heads/review');
 }));
 it('sends distinct branch SHAs and only explicitly selected tag snapshots; supports tags only',async()=>pair(async(remote,local)=>{
  local.run(['branch','topic']);commit(local,'next');local.run(['tag','-a','v1','-m','release']);local.run(['config','push.followTags','true']);
  const p=await plan(local);expect(p.branches[0].sha).not.toBe(p.branches[1].sha);const result=await executePushPlan(local.dir,p);expect(result.ok).toBe(true);
  expect(String(remote.run(['tag']))).toBe('');
  const sources=await queryPushSources(local.dir);expect((await executePushPlan(local.dir,{...p,branches:[],tags:sources.tags})).ok).toBe(true);
  expect(String(remote.run(['rev-parse','refs/tags/v1'])).trim()).toBe(sources.tags[0].sha);
  expect((await executePushPlan(local.dir,{...p,tags:sources.tags})).ok).toBe(true);
 }));
 it('reports partial success and non-fast-forward without changing failed branch tracking',async()=>pair(async(remote,local)=>{
  await executePushPlan(local.dir,await plan(local));local.run(['branch','topic']);commit(local,'advanced');await executePushPlan(local.dir,await plan(local));
  local.run(['reset','--hard','HEAD^']);commit(local,'divergent');const p=await plan(local);p.branches.forEach(b=>{b.track=true;if(b.ref.endsWith('/topic'))b.destination='refs/heads/new-topic';});
  const result=await executePushPlan(local.dir,p);expect(result.ok).toBe(false);expect(result.refs.map(r=>r.status).sort()).toEqual(['rejected','success']);
  expect(String(local.run(['config','--get','branch.topic.merge']))).toContain('refs/heads/new-topic');
  expect(spawnSync('git',['config','--get','branch.main.remote'],{cwd:local.dir}).status).toBe(1);
 }));
 it('rejects stale branches and tags inside the mutation queue before spawn',async()=>pair(async(remote,local)=>{
  local.run(['tag','v1']);const p=await plan(local);p.tags=(await queryPushSources(local.dir)).tags;
  let release!:()=>void;const blocker=enqueueGitCommandForRepo(local.dir,()=>new Promise<void>(r=>release=r),{lane:'mutation'});await Promise.resolve();
  const pushing=executePushPlan(local.dir,p);commit(local,'changed');release();await blocker;
  await expect(pushing).rejects.toThrow('selected source changed');expect(spawnSync('git',['show-ref'],{cwd:remote.dir}).status).toBe(1);
 }));
 it('rejects stale tag objects in tags-only mode and preserves destination state',async()=>pair(async(remote,local)=>{
  local.run(['tag','v1']);const p:PushPlan={remote:'origin',branches:[],tags:(await queryPushSources(local.dir)).tags};commit(local,'new-tag-target');local.run(['tag','-f','v1']);
  await expect(executePushPlan(local.dir,p)).rejects.toThrow('selected source changed');expect(String(remote.run(['tag']))).toBe('');
 }));
 it('cancels a queued plan without sending refs',async()=>pair(async(remote,local)=>{
  const p=await plan(local);const controller=new AbortController();controller.abort();await expect(executePushPlan(local.dir,p,{signal:controller.signal})).rejects.toBeTruthy();expect(String(remote.run(['tag']))).toBe('');
 }));
 it('validates blank, invalid, duplicate targets and empty plans',()=>{
  const source={ref:'refs/heads/main',sha:'a'.repeat(40),destination:'refs/heads/main',track:false};
  expect(pushPlanError({remote:'origin',branches:[],tags:[]})).toContain('Select');
  for(const target of ['refs/heads/','refs/heads/a//b','refs/heads/a/.hidden','refs/heads/a.lock/x','refs/heads/invalid name'])expect(pushPlanError({remote:'origin',branches:[{...source,destination:target}],tags:[]})).toContain('valid');
  expect(pushPlanError({remote:'origin',branches:[source,source],tags:[]})).toContain('unique');
 });
});
