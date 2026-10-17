import { beforeEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createTempGitRepo, describeIfGitInstalled, type TempGitRepo } from './test/gitTempRepoHarness';
import { resetGitCommandQueueForTests } from './gitCommandQueue';
import { pullRemote, queryRemoteHeads } from './gitRemotes';
import { DEFAULT_PULL_OPTIONS, queryGitOperationState, queryPullSnapshot, recoverGitOperation, type PullOptions } from './gitPull';
vi.mock('@tauri-apps/plugin-fs', () => ({ readDir: vi.fn(async (path: string) => (await readdir(path)).map(name => ({ name }))) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (_command: string, { request }: { request: { repoRoot: string; args: string[] } }) => {
  const result = spawnSync('git', request.args, { cwd: request.repoRoot, encoding: 'utf8', env: { ...process.env, GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } });
  return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr, durationMs: 1 };
}) }));
vi.mock('../services/logging', () => ({ logDiagnostic: vi.fn() }));
beforeEach(() => resetGitCommandQueueForTests());
function commit(repo: TempGitRepo, file: string, text: string) { repo.writeFile(file, text); repo.run(['add', file]); repo.run(['commit', '-m', text]); }
async function pair(run: (remote: TempGitRepo, local: TempGitRepo) => Promise<void>) {
  const remote = createTempGitRepo(), local = createTempGitRepo();
  try {
    remote.run(['checkout', '-B', 'main']); commit(remote, 'shared.txt', 'base\n');
    local.run(['remote', 'add', 'origin', remote.dir]); local.run(['fetch', 'origin']); local.run(['checkout', '-B', 'main', 'origin/main']);
    await run(remote, local);
  } finally { remote.cleanup(); local.cleanup(); }
}
async function pull(local: TempGitRepo, options: Partial<PullOptions> = {}) {
  return pullRemote(local.dir, { remoteName: 'origin', branchName: 'main' }, { pull: { ...DEFAULT_PULL_OPTIONS, ...options }, expected: await queryPullSnapshot(local.dir) });
}
describeIfGitInstalled('pull variants against temporary local remotes', () => {
  it('lists remote heads and explicitly fast-forwards despite conflicting global-style repo defaults', async () => pair(async (remote, local) => {
    local.run(['config', 'pull.rebase', 'true']); local.run(['config', 'pull.ff', 'only']);
    expect(await queryRemoteHeads(local.dir, 'origin')).toEqual(['main']);
    commit(remote, 'new.txt', 'remote'); await pull(local);
    expect(local.run(['rev-parse', 'HEAD'])).toBe(remote.run(['rev-parse', 'HEAD']));
    expect((await queryGitOperationState(local.dir)).kind).toBe('none');
  }));
  it('merges divergent branches with two parents and optional commit log', async () => pair(async (remote, local) => {
    local.run(['config', 'pull.ff', 'only']); commit(local, 'local.txt', 'local'); commit(remote, 'remote.txt', 'remote message');
    await pull(local, { log: true });
    expect(String(local.run(['rev-list', '--parents', '-1', 'HEAD'])).trim().split(' ')).toHaveLength(3);
    expect(String(local.run(['log', '-1', '--format=%B']))).toContain('remote message');
  }));
  it('leaves no-commit/no-ff merge recoverable on a fresh state read; continue creates the merge', async () => pair(async (remote, local) => {
    commit(remote, 'remote.txt', 'remote'); const before = local.run(['rev-parse', 'HEAD']);
    await pull(local, { commit: false, noFastForward: true });
    expect(local.run(['rev-parse', 'HEAD'])).toBe(before);
    expect(await queryGitOperationState(local.dir)).toEqual({ kind: 'merge', conflicts: [] });
    await recoverGitOperation(local.dir, 'merge', 'continue');
    expect((await queryGitOperationState(local.dir)).kind).toBe('none');
    expect(String(local.run(['rev-list', '--parents', '-1', 'HEAD'])).trim().split(' ')).toHaveLength(3);
  }));
  it('no-commit permits fast-forward without leaving merge state', async () => pair(async (remote, local) => {
    commit(remote, 'remote.txt', 'remote'); await pull(local, { commit: false });
    expect((await queryGitOperationState(local.dir)).kind).toBe('none');
    expect(local.run(['rev-parse', 'HEAD'])).toBe(remote.run(['rev-parse', 'HEAD']));
  }));
  it('rebases divergence and ignores preserved merge-only values', async () => pair(async (remote, local) => {
    commit(local, 'local.txt', 'local'); const old = local.run(['rev-parse', 'HEAD']); commit(remote, 'remote.txt', 'remote');
    await pull(local, { strategy: 'rebase', commit: false, noFastForward: true, log: true });
    expect(local.run(['rev-parse', 'HEAD'])).not.toBe(old);
    expect(local.run(['rev-parse', 'HEAD^'])).toBe(remote.run(['rev-parse', 'HEAD']));
    expect((await queryGitOperationState(local.dir)).kind).toBe('none');
  }));
  for (const strategy of ['merge', 'rebase'] as const) {
    it(`${strategy} conflicts survive restart reads, block continue, and abort restores HEAD`, async () => pair(async (remote, local) => {
      commit(local, 'shared.txt', 'local conflict'); const before = local.run(['rev-parse', 'HEAD']); commit(remote, 'shared.txt', 'remote conflict');
      await expect(pull(local, { strategy })).rejects.toBeTruthy();
      expect(await queryGitOperationState(local.dir)).toEqual({ kind: strategy, conflicts: ['shared.txt'] });
      await expect(recoverGitOperation(local.dir, strategy, 'continue')).rejects.toThrow('Resolve and stage');
      await expect(pullRemote(local.dir, {remoteName:'origin',branchName:'main'}, {pull:DEFAULT_PULL_OPTIONS})).rejects.toThrow('Finish the current');
      await recoverGitOperation(local.dir, strategy, 'abort');
      expect(local.run(['rev-parse', 'HEAD'])).toBe(before);
      expect((await queryGitOperationState(local.dir)).kind).toBe('none');
    }));
    it(`${strategy} continues after conflicts are resolved and staged`, async () => pair(async (remote, local) => {
      commit(local, 'shared.txt', 'local conflict'); commit(remote, 'shared.txt', 'remote conflict');
      await expect(pull(local, { strategy })).rejects.toBeTruthy();
      local.writeFile('shared.txt', 'resolved'); local.run(['add', 'shared.txt']);
      await recoverGitOperation(local.dir, strategy, 'continue');
      expect((await queryGitOperationState(local.dir)).kind).toBe('none');
      expect(String(local.run(['show', 'HEAD:shared.txt']))).toBe('resolved');
    }));
  }
  it('rejects HEAD changes after dialog snapshot before any pull', async () => pair(async (remote, local) => {
    const expected = await queryPullSnapshot(local.dir); commit(local, 'new.txt', 'new');
    await expect(pullRemote(local.dir, { remoteName: 'origin', branchName: 'main' }, { pull: DEFAULT_PULL_OPTIONS, expected })).rejects.toThrow('HEAD or the target branch changed');
  }));
  it('finds operation markers in a linked worktree Git directory and aborts there', async () => pair(async (remote, local) => {
    const linked = `${local.dir}-linked`;
    try {
      local.run(['worktree', 'add', '-b', 'linked', linked]);
      commit(remote, 'remote.txt', 'remote');
      await pullRemote(linked, {remoteName:'origin',branchName:'main'}, {pull:{...DEFAULT_PULL_OPTIONS,commit:false,noFastForward:true},expected:await queryPullSnapshot(linked)});
      expect(await queryGitOperationState(linked)).toEqual({kind:'merge',conflicts:[]});
      await recoverGitOperation(linked, 'merge', 'abort');
      expect((await queryGitOperationState(linked)).kind).toBe('none');
    } finally { rmSync(linked, {recursive:true,force:true}); }
  }));

});
