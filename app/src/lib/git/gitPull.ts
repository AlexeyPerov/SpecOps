import { readDir } from '@tauri-apps/plugin-fs';
import { runGit } from './gitRun';
import { assertGitCommandCompleted } from './gitErrors';
import { createGitCommandError, normalizeGitOutputPath, type CancellableGitOptions } from './types';

export interface PullOptions {
  strategy: 'merge' | 'rebase';
  commit: boolean;
  log: boolean;
  noFastForward: boolean;
}
export const DEFAULT_PULL_OPTIONS: PullOptions = { strategy: 'merge', commit: true, log: false, noFastForward: false };
export interface PullSnapshot { head: string; branch: string }
export type GitOperationKind = 'none' | 'merge' | 'rebase' | 'unsupported';
export interface GitOperationState { kind: GitOperationKind; conflicts: string[] }

export function pullOptionArgs(options: PullOptions): string[] {
  if (options.strategy === 'rebase') return ['--rebase=true', '--no-autostash'];
  return ['--no-rebase', options.commit ? '--commit' : '--no-commit', options.log ? '--log' : '--no-log', options.noFastForward ? '--no-ff' : '--ff', '--no-edit', '--no-autostash'];
}
export function redactRemoteUrl(url: string): string {
  return url.replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/]*@/gi, '$1***@').replace(/([?&#](?:access_token|token|password|secret|api_key)=)[^&#\s]*/gi, '$1***');
}
export async function queryPullSnapshot(root: string): Promise<PullSnapshot> {
  const head = await runGit(root, ['rev-parse', '--verify', 'HEAD'], 'versionControl');
  if (head.exitCode !== 0) throw createGitCommandError(head);
  const branch = await runGit(root, ['branch', '--show-current'], 'versionControl');
  if (branch.exitCode !== 0) throw createGitCommandError(branch);
  if (!branch.stdout.trim()) throw new Error('Checkout a local branch before pulling.');
  return { head: head.stdout.trim(), branch: branch.stdout.trim() };
}
export async function assertPullSnapshot(root: string, expected: PullSnapshot): Promise<void> {
  const actual = await queryPullSnapshot(root);
  if (actual.head !== expected.head || actual.branch !== expected.branch) throw new Error('HEAD or the target branch changed. Close and reopen Pull to review the new target.');
}
export async function queryGitOperationState(root: string): Promise<GitOperationState> {
  const dir = await runGit(root, ['rev-parse', '--absolute-git-dir'], 'versionControl');
  if (dir.exitCode !== 0) throw createGitCommandError(dir);
  const entries = new Set((await readDir(normalizeGitOutputPath(dir.stdout))).map(entry => entry.name));
  const kind: GitOperationKind = entries.has('rebase-merge') || entries.has('rebase-apply') ? 'rebase' : entries.has('MERGE_HEAD') ? 'merge' : ['CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer', 'BISECT_LOG'].some(marker => entries.has(marker)) ? 'unsupported' : 'none';
  const response = await runGit(root, ['diff', '--name-only', '--diff-filter=U'], 'versionControl');
  if (response.exitCode !== 0) throw createGitCommandError(response);
  return { kind, conflicts: response.stdout.trim() ? response.stdout.trim().split('\n') : [] };
}
export async function recoverGitOperation(root: string, expected: GitOperationKind, action: 'continue' | 'abort', options?: CancellableGitOptions): Promise<void> {
  const state = await queryGitOperationState(root);
  if (state.kind !== expected || (expected !== 'merge' && expected !== 'rebase')) throw new Error('Git operation changed. Refresh repository state before continuing.');
  if (action === 'continue' && state.conflicts.length) throw new Error('Resolve and stage all conflicts in File Status before continuing.');
  const args = [expected, `--${action}`];
  const response = await runGit(root, args, 'versionControl', undefined, options);
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) throw createGitCommandError(response);
}
