import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { writable, fromStore } from 'svelte/store';
import GitNavigationTree from './GitNavigationTree.svelte';
import { mountComponent } from './_testComponentMount';
import { queryBranches, queryStashes } from '../git/gitService';
vi.mock('../git/gitService', async original => ({ ...await original<typeof import('../git/gitService')>(), queryBranches: vi.fn(), queryTags: vi.fn().mockResolvedValue(['v1']), queryStashes: vi.fn() }));
vi.mock('../git/versionControlRemotesCache', () => ({ loadRemotes: vi.fn().mockResolvedValue([]) }));
vi.mock('../git/gitNavigationTree', async original => ({ ...await original<typeof import('../git/gitNavigationTree')>(), queryRemoteTrackingRefs: vi.fn().mockResolvedValue([]) }));
async function settle() { for (let i = 0; i < 15; i++) { await Promise.resolve(); flushSync(); } }
const branch = (name: string) => ({ name, head: 'a'.repeat(40), isCurrent: false, upstream: null, upstreamTrack: null, subject: '' });
beforeEach(() => { vi.mocked(queryBranches).mockReset().mockResolvedValue([branch('feature/one'), branch('feature/two')]); vi.mocked(queryStashes).mockReset().mockResolvedValue([]); });
function row(host: HTMLElement, title: string) { return host.querySelector<HTMLButtonElement>(`[role="treeitem"][title="${title}"]`)!; }
describe('mounted repository navigation', () => {
  it('clears old refs and view state on repository change before the next read resolves', async () => {
    const root = writable('/first'); const state = fromStore(root);
    const view = mountComponent(GitNavigationTree, { get repoRoot() { return state.current; }, onSelect: vi.fn(), onAction: vi.fn() }); await settle();
    const input = view.host.querySelector<HTMLInputElement>('input')!;
    input.value = 'feature'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    let resolve!: (value: ReturnType<typeof branch>[]) => void;
    vi.mocked(queryBranches).mockImplementationOnce(() => new Promise(r => resolve = r));
    root.set('/second'); flushSync();
    expect(view.host.querySelector<HTMLInputElement>('input')!.value).toBe('');
    expect(view.host.textContent).toContain('Loading navigation');
    expect(view.host.querySelector('[title="refs/heads/feature/one"]')).toBeNull();
    resolve([branch('next/repository')]); await settle();
    expect(view.host.querySelector('[title="refs/heads/next/repository"]')).not.toBeNull();
  });
  it('selects refs for viewing, exposes explicit actions, and restores collapsed paths after filtering', async () => {
    const onSelect = vi.fn(), onAction = vi.fn();
    const view = mountComponent(GitNavigationTree, { repoRoot: '/repo', onSelect, onAction }); await settle();
    row(view.host, 'refs/heads/feature/one').click(); flushSync();
    expect(onSelect.mock.calls.at(-1)?.[0].revision).toBe('refs/heads/feature/one'); expect(onAction).not.toHaveBeenCalled();
    row(view.host, 'branches').click(); flushSync();
    expect(row(view.host, 'refs/heads/feature/one')).toBeNull();
    const input = view.host.querySelector<HTMLInputElement>('input')!;
    input.value = 'feature/one'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(row(view.host, 'refs/heads/feature/one')).not.toBeNull();
    row(view.host, 'refs/heads/feature/one').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); flushSync();
    Array.from(view.host.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.includes('Branch actions'))!.click(); flushSync();
    expect(onAction).toHaveBeenCalledWith('branches', 'refs/heads/feature/one');
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(row(view.host, 'refs/heads/feature/one')).toBeNull();
    expect(view.host.textContent).toContain('Search unavailable');
  });
  it('explains local read errors and empty filters', async () => {
    vi.mocked(queryBranches).mockRejectedValueOnce({ kind: 'command', message: 'Cannot read refs', stderr: 'Cannot read refs', exitCode: 128 });
    const failed = mountComponent(GitNavigationTree, { repoRoot: '/failed', onSelect: vi.fn(), onAction: vi.fn() }); await settle();
    expect(failed.host.querySelector('[role="alert"]')?.textContent).toContain('Cannot read refs');
    const ready = mountComponent(GitNavigationTree, { repoRoot: '/ready', onSelect: vi.fn(), onAction: vi.fn() }); await settle();
    const input = ready.host.querySelector<HTMLInputElement>('input')!;
    input.value = 'absent-reference'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(ready.host.textContent).toContain('No matching references');
  });
  it('supports roving keyboard focus and never activates search', async () => {
    const onSelect = vi.fn(); const view = mountComponent(GitNavigationTree, { repoRoot: '/repo', onSelect, onAction: vi.fn() }); await settle();
    const history = row(view.host, 'history'); history.focus();
    history.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); flushSync();
    expect(document.activeElement).toBe(row(view.host, 'changes'));
    view.host.querySelector<HTMLButtonElement>('[role="treeitem"][aria-disabled="true"]')!.click(); expect(onSelect).not.toHaveBeenCalled();
    expect(view.host.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
  });
  it('shows a deleted-selection state and ignores a late response after unmount', async () => {
    const onSelect = vi.fn();
    const view = mountComponent(GitNavigationTree, { repoRoot: '/repo', selectedId: 'refs/heads/deleted', onSelect, onAction: vi.fn() }); await settle();
    expect(view.host.textContent).toContain('selected reference is no longer available'); expect(onSelect).toHaveBeenCalledWith(null);
    let resolve!: (value: ReturnType<typeof branch>[]) => void;
    vi.mocked(queryBranches).mockImplementationOnce(() => new Promise(r => resolve = r));
    const staleSelect = vi.fn();
    const old = mountComponent(GitNavigationTree, { repoRoot: '/old', selectedId: 'refs/heads/deleted', onSelect: staleSelect, onAction: vi.fn() }); flushSync(); old.unmount();
    const fresh = mountComponent(GitNavigationTree, { repoRoot: '/new', onSelect: vi.fn(), onAction: vi.fn() }); await settle();
    resolve([branch('private/old')]); await settle();
    expect(fresh.host.textContent).not.toContain('private'); expect(staleSelect).not.toHaveBeenCalled();
  });
});

it('keeps bare refs available without requesting working-tree-only stash data', async () => {
  const view=mountComponent(GitNavigationTree,{repoRoot:'/bare.git',bare:true,onSelect:vi.fn(),onAction:vi.fn()});
  await settle();
  expect(queryStashes).not.toHaveBeenCalled();
  expect(view.host.querySelector('[title="refs/heads/feature/one"]')).not.toBeNull();
  expect(view.host.querySelector('[title="changes"]')).toBeNull();
  expect(view.host.querySelector('[title="stashes"]')).toBeNull();
});

it('restores scoped navigation filter, collapse and keyboard focus after remount', async () => {
 const {clearGitWorkspaceViewStateForTests}=await import('../git/gitWorkspaceViewState');clearGitWorkspaceViewStateForTests();
 const props={repoRoot:'/repo',stateKey:'window-a:workspace-a',onSelect:vi.fn(),onAction:vi.fn()};
 const first=mountComponent(GitNavigationTree,props);await settle();row(first.host,'branches').click();flushSync();
 const input=first.host.querySelector<HTMLInputElement>('input')!;input.value='feature/one';input.dispatchEvent(new Event('input',{bubbles:true}));flushSync();row(first.host,'refs/heads/feature/one').focus();flushSync();
 first.unmount();const second=mountComponent(GitNavigationTree,props);await settle();expect(second.host.querySelector<HTMLInputElement>('input')!.value).toBe('feature/one');expect(row(second.host,'refs/heads/feature/one').tabIndex).toBe(0);
 const other=mountComponent(GitNavigationTree,{...props,stateKey:'window-b:workspace-a'});await settle();expect(other.host.querySelector<HTMLInputElement>('input')!.value).toBe('');
 const restored=second.host.querySelector<HTMLInputElement>('input')!;restored.value='';restored.dispatchEvent(new Event('input',{bubbles:true}));flushSync();expect(row(second.host,'refs/heads/feature/one')).toBeNull();
});
