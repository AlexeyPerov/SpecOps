import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readDir } from '@tauri-apps/plugin-fs';
import { runGit, runRemoteGit } from './gitRun';
import { buildPullArgs, queryRemoteHeads } from './gitRemotes';
import { DEFAULT_PULL_OPTIONS, pullOptionArgs, redactRemoteUrl, queryGitOperationState } from './gitPull';
import { GitCommandCancelledError } from './gitErrors';
vi.mock('@tauri-apps/plugin-fs',()=>({readDir:vi.fn()}));
vi.mock('./gitRun',()=>({runGit:vi.fn(),runRemoteGit:vi.fn()}));
beforeEach(()=>vi.resetAllMocks());
describe('Pull arguments and remote heads',()=>{
 it('uses explicit supported merge defaults and drops all merge flags for rebase',()=>{
 expect(buildPullArgs({remoteName:'origin',branchName:'topic/nested'},DEFAULT_PULL_OPTIONS)).toEqual(['pull','--no-rebase','--commit','--no-log','--ff','--no-edit','--no-autostash','origin','topic/nested']);
 expect(pullOptionArgs({...DEFAULT_PULL_OPTIONS,strategy:'rebase',log:true,noFastForward:true,commit:false})).toEqual(['--rebase=true','--no-autostash']);
 expect(()=>buildPullArgs({remoteName:'--evil',branchName:'main'},DEFAULT_PULL_OPTIONS)).toThrow('Remote name');
 expect(()=>buildPullArgs({remoteName:'origin',branchName:'--evil'},DEFAULT_PULL_OPTIONS)).toThrow('Invalid remote branch');
 });
 it('queries only heads through the shared authenticated cancellable runner',async()=>{
 vi.mocked(runRemoteGit).mockResolvedValue({exitCode:0,stdout:'abc123\trefs/heads/z\nabc123\trefs/heads/topic/main\nabc123\trefs/tags/no\nabc123\trefs/heads/z\n',stderr:'',durationMs:1});
 const signal=new AbortController().signal;expect(await queryRemoteHeads('/repo','origin',{commandId:'probe',signal,bypassQueue:true})).toEqual(['topic/main','z']);
 expect(runRemoteGit).toHaveBeenCalledWith('/repo',['ls-remote','--heads','origin'],'versionControl',expect.objectContaining({operation:'lsRemote',commandId:'probe',signal,bypassQueue:true}));
 });
 it('propagates auth errors and process cancellation without returning empty success',async()=>{
 vi.mocked(runRemoteGit).mockResolvedValueOnce({exitCode:128,stdout:'',stderr:'Authentication failed',durationMs:1});await expect(queryRemoteHeads('/repo','origin')).rejects.toMatchObject({kind:'command',stderr:'Authentication failed'});
 vi.mocked(runRemoteGit).mockResolvedValueOnce({exitCode:1,stdout:'',stderr:'',durationMs:1,cancelled:true});await expect(queryRemoteHeads('/repo','origin')).rejects.toBeInstanceOf(GitCommandCancelledError);
 });
 it('redacts passwords, user-info tokens and sensitive URL query values',()=>{
 expect(redactRemoteUrl('https://token@example.test/r')).toBe('https://***@example.test/r');expect(redactRemoteUrl('ssh://user:password@example.test/r')).toBe('ssh://***@example.test/r');expect(redactRemoteUrl('https://user:p%40ss@example.test/r?access_token=abc&branch=main')).toBe('https://***@example.test/r?access_token=***&branch=main');
 });
 it('blocks on unreadable Git state instead of assuming no operation exists',async()=>{
 vi.mocked(runGit).mockResolvedValueOnce({exitCode:0,stdout:'/repo/.git\n',stderr:'',durationMs:1});vi.mocked(readDir).mockRejectedValueOnce(new Error('Permission denied'));
 await expect(queryGitOperationState('/repo')).rejects.toThrow('Permission denied');
 });

});
