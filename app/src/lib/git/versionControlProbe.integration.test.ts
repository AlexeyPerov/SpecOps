import { expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describeIfGitInstalled } from './test/gitTempRepoHarness';
import { probeVersionControlContext } from './versionControlProbe';
import { resetGitCommandQueueForTests } from './gitCommandQueue';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (_command: string, payload?: {request?: {repoRoot: string; args: string[]}}) => {
  if (!payload?.request) return { available: true, version: 'git', error: null };
  const {repoRoot,args}=payload.request;
  const result=spawnSync('git',args,{cwd:repoRoot,encoding:'utf8'});
  return {exitCode:result.status ?? 1,stdout:result.stdout,stderr:result.stderr,durationMs:1};
}) }));
vi.mock('../services/logging', () => ({ logDiagnostic: vi.fn() }));
describeIfGitInstalled('repository capability probing against real Git', () => {
  it('opens a bare repository despite its missing worktree, and rejects an ordinary folder', async () => {
    resetGitCommandQueueForTests();
    const root=mkdtempSync(join(tmpdir(),'specops-probe-'));
    const bare=join(root,'remote.git');
    try {
      expect(spawnSync('git',['init','--bare',bare]).status).toBe(0);
      expect(await probeVersionControlContext(bare)).toEqual({kind:'ready',workspaceRootPath:bare,repoRoot:realpathSync(bare),isBareRepository:true});
      expect(await probeVersionControlContext(root)).toEqual({kind:'notARepository',workspaceRootPath:root});
    } finally { rmSync(root,{recursive:true,force:true}); }
  });
});
