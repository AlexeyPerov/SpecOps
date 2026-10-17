import { runGit, runRemoteGit } from './gitRun';
import { validateRemoteName } from './gitRemotes';
import { validateGitRefName } from './gitRefName';
import { createGitCommandError, type CancellableGitOptions } from './types';

export interface PushSource { ref: string; sha: string }
export interface PushBranch extends PushSource { name: string; upstream: string; upstreamRemote: string; upstreamBranch: string; current: boolean }
export interface PushEntry extends PushSource { destination: string; track: boolean }
export interface PushPlan { remote: string; branches: PushEntry[]; tags: PushSource[] }
export interface PushRefResult { destination: string; status: 'success' | 'rejected' | 'unknown'; summary: string; trackingError?: string }
export interface PushResult { refs: PushRefResult[]; ok: boolean; cancelled: boolean; message: string }
export async function queryPushSources(root: string): Promise<{ branches: PushBranch[]; tags: PushSource[] }> {
  const response = await runGit(root, ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(HEAD)%09%(upstream:short)%09%(upstream:remotename)%09%(upstream:remoteref)', 'refs/heads/', 'refs/tags/'], 'versionControl');
  if (response.exitCode !== 0) throw createGitCommandError(response);
  const branches: PushBranch[] = [], tags: PushSource[] = [];
  for (const line of response.stdout.trim().split('\n').filter(Boolean)) {
    const [ref, sha, head, upstream, upstreamRemote, upstreamBranch] = line.split('\t');
    if (ref.startsWith('refs/tags/')) tags.push({ ref, sha });
    else branches.push({ ref, sha, name: ref.slice(11), current: head === '*', upstream: upstream ?? '', upstreamRemote: upstreamRemote ?? '', upstreamBranch: (upstreamBranch ?? '').replace(/^refs\/heads\//, '') });
  }
  return { branches, tags };
}
function validRef(ref: string, prefix: string): boolean {
  const name = ref.slice(prefix.length);
  return ref.startsWith(prefix) && name === name.trim() && validateGitRefName(name).ok && name.split('/').every(part => !!part && !part.startsWith('.') && !part.endsWith('.lock'));
}
export function pushPlanError(plan: PushPlan): string | null {
  try { validateRemoteName(plan.remote); } catch { return 'Choose a valid remote.'; }
  if (!plan.branches.length && !plan.tags.length) return 'Select at least one branch or Push all tags.';
  const destinations = new Set<string>();
  for (const entry of [...plan.branches.map(branch => ({...branch, prefix: 'refs/heads/'})), ...plan.tags.map(tag => ({ ...tag, destination: tag.ref, track: false, prefix: 'refs/tags/' }))]) {
    const prefix = entry.prefix;
    if (!validRef(entry.ref, prefix) || !/^[a-f0-9]{40,64}$/i.test(entry.sha) || !validRef(entry.destination, prefix)) return 'Enter valid source and destination refs.';
    if (destinations.has(entry.destination)) return 'Remote branch destinations must be unique.';
    destinations.add(entry.destination);
  }
  return null;
}
export async function executePushPlan(root: string, plan: PushPlan, options?: CancellableGitOptions): Promise<PushResult> {
  const error = pushPlanError(plan); if (error) throw new Error(error);
  const entries = [...plan.branches, ...plan.tags.map(tag => ({ ...tag, destination: tag.ref, track: false }))];
  const response = await runRemoteGit(root, ['push', '--porcelain', '--no-follow-tags', plan.remote, ...entries.map(entry => `${entry.sha}:${entry.destination}`)], 'versionControl', { ...options, expectedRefs: entries.map(({ref,sha})=>({ref,sha})), operation: 'push' });
  const refs: PushRefResult[] = entries.map(entry => ({ destination: entry.destination, status: 'unknown', summary: 'No confirmed result. Refresh before retrying.' }));
  for (const line of response.stdout.split('\n')) {
    const [flag, mapping, summary] = line.split('\t');
    if (!mapping || !summary) continue;
    const result = refs.find(ref => ref.destination === mapping.slice(mapping.indexOf(':') + 1));
    if (result) { result.status = flag === '!' ? 'rejected' : [' ', '=', '*', '+'].includes(flag) ? 'success' : 'unknown'; result.summary = summary; }
  }
  for (const entry of plan.branches.filter(entry => entry.track)) {
    const result = refs.find(ref => ref.destination === entry.destination)!;
    if (result.status !== 'success') continue;
    if (response.cancelled || response.timedOut || options?.signal?.aborted) { result.trackingError = 'Tracking was not changed because the operation was interrupted.'; continue; }
    try {
      for (const [key, value] of [['remote', plan.remote], ['merge', entry.destination]]) {
        const configured = await runGit(root, ['config', '--local', `branch.${entry.ref.slice(11)}.${key}`, value], 'versionControl', undefined, { signal: options?.signal, onStart: options?.onStart, expectedRefs: [{ref: entry.ref, sha: entry.sha}] });
        if (configured.exitCode !== 0 || configured.cancelled) throw createGitCommandError(configured);
      }
    } catch { result.trackingError = 'Push succeeded, but tracking configuration could not be saved. Refresh before changing tracking.'; }
  }
  return { refs, ok: response.exitCode === 0 && !response.cancelled && !response.timedOut && !options?.signal?.aborted && refs.every(ref=>ref.status==='success' && !ref.trackingError), cancelled: !!response.cancelled || !!options?.signal?.aborted, message: response.stderr };
}
