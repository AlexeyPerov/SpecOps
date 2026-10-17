import { runGit } from './gitRun';
import { createGitCommandError, type BranchSummary, type GitRemote, type GitStashSummary } from './types';

export interface NavigationRef { name: string; sha: string; symbolicTarget: string | null }
export interface NavigationNode {
  id: string; label: string; kind: 'group' | 'workspace' | 'branch' | 'remote' | 'tag' | 'stash';
  children?: NavigationNode[]; revision?: string; branch?: BranchSummary; stash?: GitStashSummary;
  detail?: string;
}
/** Local tracking refs only: opening navigation never contacts a remote. */
export async function queryRemoteTrackingRefs(root: string): Promise<NavigationRef[]> {
  const result = await runGit(root, ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(symref)', 'refs/remotes/'], 'versionControl');
  if (result.exitCode !== 0) throw createGitCommandError(result);
  return result.stdout.split('\n').filter(Boolean).map(line => {
    const [name, sha, symbolicTarget] = line.split('\t');
    return { name, sha, symbolicTarget: symbolicTarget || null };
  });
}
function group(id: string, label: string): NavigationNode { return { id, label, kind: 'group', children: [] }; }
function insert(root: NavigationNode, path: string, node: NavigationNode): void {
  const segments = path.split('/');
  let parent = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const id = `${root.id}/group/${segments.slice(0, i + 1).join('/')}`;
    let child = parent.children!.find(candidate => candidate.id === id);
    if (!child) { child = group(id, segments[i]); parent.children!.push(child); }
    parent = child;
  }
  parent.children!.push({ ...node, label: segments.at(-1)! });
}
export function buildNavigationTree(branches: BranchSummary[], tags: string[], remotes: GitRemote[], refs: NavigationRef[], stashes: GitStashSummary[]): NavigationNode[] {
  const workspace = group('workspace', 'Workspace');
  workspace.children = ['changes', 'history', 'search'].map(id => ({ id, label: id[0].toUpperCase() + id.slice(1), kind: 'workspace', detail: id === 'search' ? 'Commit search is not available yet' : undefined }));
  const local = group('branches', 'Branches');
  for (const branch of branches) insert(local, branch.name, { id: `refs/heads/${branch.name}`, label: branch.name, kind: 'branch', revision: `refs/heads/${branch.name}`, branch, detail: branch.upstreamTrack ?? undefined });
  const tagRoot = group('tags', 'Tags');
  for (const tag of tags) insert(tagRoot, tag, { id: `refs/tags/${tag}`, label: tag, kind: 'tag', revision: `refs/tags/${tag}` });
  const remoteRoot = group('remotes', 'Remotes');
  const configuredNames = remotes.map(remote => remote.name).sort((a, b) => b.length - a.length);
  const owner = (ref: NavigationRef): string => configuredNames.find(name => ref.name.startsWith(`refs/remotes/${name}/`)) ?? ref.name.slice('refs/remotes/'.length).split('/')[0];
  for (const name of new Set([...configuredNames, ...refs.map(owner)])) {
    const remote = group(`remote/${name}`, name);
    for (const ref of refs.filter(ref => owner(ref) === name)) insert(remote, ref.name.slice(`refs/remotes/${name}/`.length), { id: ref.name, label: ref.name, kind: 'remote', revision: ref.name, detail: ref.symbolicTarget ? `HEAD → ${ref.symbolicTarget.replace('refs/remotes/', '')}` : undefined });
    remoteRoot.children!.push(remote);
  }
  const stashRoot = group('stashes', 'Stashes');
  stashRoot.children = stashes.map(stash => ({ id: `stash/${stash.sha}`, label: `${stash.ref}: ${stash.message.split('\n')[0]}`, kind: 'stash', stash, revision: stash.sha, detail: `${stash.message}\n${new Date(stash.createdAt * 1000).toLocaleString()}` }));
  return [workspace, local, tagRoot, remoteRoot, stashRoot];
}
export interface NavigationRow { node: NavigationNode; depth: number; parentId: string | null; expanded: boolean }
/** Filtering derives expansion without changing the user's stored expansion. */
export function visibleNavigationRows(nodes: NavigationNode[], collapsed: readonly string[], filter: string): NavigationRow[] {
  const query = filter.trim().toLocaleLowerCase();
  const matches = (node: NavigationNode): boolean => `${node.id} ${node.label}`.toLocaleLowerCase().includes(query) || !!node.children?.some(matches);
  const rows: NavigationRow[] = [];
  const visit = (items: NavigationNode[], depth: number, parentId: string | null) => {
    for (const node of items) {
      if (query && !matches(node)) continue;
      const expanded = !!node.children && (!!query || !collapsed.includes(node.id));
      rows.push({ node, depth, parentId, expanded });
      if (expanded) visit(node.children!, depth + 1, node.id);
    }
  };
  visit(nodes, 1, null);
  return rows;
}
export function findNavigationNode(nodes: NavigationNode[], id: string): NavigationNode | null {
  for (const node of nodes) { if (node.id === id) return node; const child = findNavigationNode(node.children ?? [], id); if (child) return child; }
  return null;
}
