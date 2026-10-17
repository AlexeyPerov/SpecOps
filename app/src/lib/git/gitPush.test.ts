import { beforeEach, expect, it, vi } from 'vitest';
import { executePushPlan, pushPlanError, type PushPlan } from './gitPush';
import { runGit, runRemoteGit } from './gitRun';
vi.mock('./gitRun',()=>({runGit:vi.fn(),runRemoteGit:vi.fn()}));
const sha='a'.repeat(40), destination='refs/heads/review';
const plan:PushPlan={remote:'origin',branches:[{ref:'refs/heads/main',sha,destination,track:true}],tags:[]};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(runGit).mockResolvedValue({exitCode:0,stdout:'',stderr:'',durationMs:1});});
it('keeps exact sources/destinations, expected refs, authentication context, and config local',async()=>{
 vi.mocked(runRemoteGit).mockResolvedValue({exitCode:0,stdout:`*\t${sha}:${destination}\t[new branch]\n`,stderr:'',durationMs:1});
 expect((await executePushPlan('/repo',plan)).ok).toBe(true);expect(runRemoteGit).toHaveBeenCalledWith('/repo',['push','--porcelain','--no-follow-tags','origin',`${sha}:${destination}`],'versionControl',expect.objectContaining({operation:'push',expectedRefs:[{ref:'refs/heads/main',sha}]}));
 expect(runGit).toHaveBeenCalledWith('/repo',['config','--local','branch.main.remote','origin'],'versionControl',undefined,expect.anything());expect(runGit).toHaveBeenCalledWith('/repo',['config','--local','branch.main.merge',destination],'versionControl',undefined,expect.anything());
});
for(const flag of ['cancelled','timedOut'] as const)it(`does not change tracking after ${flag}, even with confirmed refs`,async()=>{
 vi.mocked(runRemoteGit).mockResolvedValue({exitCode:1,stdout:`*\t${sha}:${destination}\t[new branch]\n`,stderr:'interrupted',durationMs:1,[flag]:true});
 const result=await executePushPlan('/repo',plan);expect(result.ok).toBe(false);expect(result.refs[0].status).toBe('success');expect(result.refs[0].trackingError).toContain('interrupted');expect(runGit).not.toHaveBeenCalled();expect(runRemoteGit).toHaveBeenCalledOnce();
});
it('reports unknown refs on ambiguous failure and never retries',async()=>{
 vi.mocked(runRemoteGit).mockResolvedValue({exitCode:1,stdout:'',stderr:'connection lost',durationMs:1});const result=await executePushPlan('/repo',plan);expect(result.ok).toBe(false);expect(result.refs[0].status).toBe('unknown');expect(runGit).not.toHaveBeenCalled();expect(runRemoteGit).toHaveBeenCalledOnce();
});
it('rejects invalid source names even with a valid destination',()=>{for(const ref of ['refs/heads/a//b','refs/heads/../../HEAD','refs/heads/.hidden','refs/tags/a'])expect(pushPlanError({...plan,branches:[{...plan.branches[0],ref}]})).toContain('valid');});
it('honors cancellation between tracking writes and reports incomplete configuration',async()=>{
 const controller=new AbortController();vi.mocked(runRemoteGit).mockResolvedValue({exitCode:0,stdout:`*\t${sha}:${destination}\t[new branch]\n`,stderr:'',durationMs:1});
 vi.mocked(runGit).mockImplementation(async()=>{controller.abort();throw new Error('cancelled');});const result=await executePushPlan('/repo',plan,{signal:controller.signal});expect(result.ok).toBe(false);expect(result.cancelled).toBe(true);expect(result.refs[0].trackingError).toBeTruthy();expect(runGit).toHaveBeenCalledOnce();
});
