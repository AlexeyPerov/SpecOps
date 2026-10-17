import { describe, expect, it, vi } from 'vitest';
import { buildNavigationTree, findNavigationNode, visibleNavigationRows, queryRemoteTrackingRefs } from './gitNavigationTree';
import { buildQueryCommitsArgs } from './gitHistory';
import { runGit } from './gitRun';
vi.mock('./gitRun', () => ({ runGit: vi.fn() }));
const branch = (name: string) => ({ name, head: 'a'.repeat(40), isCurrent: name === 'master', upstream: null, upstreamTrack: null, subject: '' });
const stash = { sha: 'c'.repeat(40), parents: [], ref: 'stash@{1}', createdAt: 1700000000, message: 'Saved changes' };
const tree = () => buildNavigationTree([branch('feature/one'), branch('feature/two'), branch('master')], ['release/one'], [{ name: 'origin', fetchUrl: '', pushUrl: '' }, { name: 'backup', fetchUrl: '', pushUrl: '' }], [{ name: 'refs/remotes/origin/feature/one', sha: 'b'.repeat(40), symbolicTarget: null }, { name: 'refs/remotes/origin/HEAD', sha: 'b'.repeat(40), symbolicTarget: 'refs/remotes/origin/feature/one' }], [stash]);
describe('repository navigation model', () => {
  it('reads tracking refs locally through the existing command queue', async () => {
    vi.mocked(runGit).mockResolvedValueOnce({ exitCode: 0, stderr: '', durationMs: 1, stdout: 'refs/remotes/origin/HEAD\tabc\trefs/remotes/origin/main\nrefs/remotes/origin/main\tabc\t\n' });
    expect(await queryRemoteTrackingRefs('/repo')).toEqual([{ name: 'refs/remotes/origin/HEAD', sha: 'abc', symbolicTarget: 'refs/remotes/origin/main' }, { name: 'refs/remotes/origin/main', sha: 'abc', symbolicTarget: null }]);
    expect(runGit).toHaveBeenCalledWith('/repo', ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(symref)', 'refs/remotes/'], 'versionControl');
  });
  it('keeps every section and distinct ref identity including the symbolic remote HEAD', () => {
    const nodes = tree();
    expect(nodes.map(n => n.id)).toEqual(['workspace', 'branches', 'tags', 'remotes', 'stashes']);
    expect(findNavigationNode(nodes, 'branches/group/feature')?.children).toHaveLength(2);
    expect(findNavigationNode(nodes, 'refs/heads/feature/one')?.revision).toBe('refs/heads/feature/one');
    expect(findNavigationNode(nodes, 'refs/remotes/origin/feature/one')?.revision).toBe('refs/remotes/origin/feature/one');
    expect(findNavigationNode(nodes, 'refs/remotes/origin/HEAD')?.detail).toContain('HEAD → origin/feature/one');
    expect(findNavigationNode(nodes, 'stash/' + stash.sha)?.stash?.ref).toBe('stash@{1}');
  });
  it('assigns a tracking ref to exactly one configured remote even for names with slashes', () => {
    const nodes = buildNavigationTree([], [], [{ name: 'team/archive', fetchUrl: '', pushUrl: '' }], [{ name: 'refs/remotes/team/archive/main', sha: 'a'.repeat(40), symbolicTarget: null }], []);
    expect(findNavigationNode(nodes, 'remotes')?.children?.map(node => node.id)).toEqual(['remote/team/archive']);
    expect(visibleNavigationRows(nodes, [], '').filter(row => row.node.id === 'refs/remotes/team/archive/main')).toHaveLength(1);
  });
  it('reveals matching ancestors without changing user expansion and restores it on clear', () => {
    const nodes = tree(), collapsed = ['branches'];
    expect(visibleNavigationRows(nodes, collapsed, '').some(r => r.node.id === 'refs/heads/feature/one')).toBe(false);
    const filtered = visibleNavigationRows(nodes, collapsed, 'feature/one');
    expect(filtered.some(r => r.node.id === 'refs/heads/feature/one')).toBe(true);
    expect(filtered.some(r => r.node.id === 'refs/heads/feature/two')).toBe(false);
    expect(collapsed).toEqual(['branches']);
    expect(visibleNavigationRows(nodes, collapsed, '').find(r => r.node.id === 'branches')?.expanded).toBe(false);
  });
  it('preserves stash identity when its positional ref shifts and detects deletions', () => {
    const shifted = buildNavigationTree([], [], [], [], [{ ...stash, ref: 'stash@{2}' }]);
    expect(findNavigationNode(shifted, 'stash/' + stash.sha)?.stash?.ref).toBe('stash@{2}');
    expect(findNavigationNode(shifted, 'refs/heads/master')).toBeNull();
  });
  it('queries selected refs instead of the general scope, including paginated history', () => {
    const args = buildQueryCommitsArgs({ revision: 'refs/tags/release/one', filterMode: 'all-branches-and-remotes', skip: 500, limit: 500 });
    expect(args).toContain('refs/tags/release/one'); expect(args).toContain('--skip=500'); expect(args).not.toContain('--branches'); expect(args).not.toContain('--remotes');
    expect(() => buildQueryCommitsArgs({ revision: '--all' })).toThrow('Invalid history revision');
  });
});
