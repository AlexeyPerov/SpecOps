import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { fromStore, writable } from 'svelte/store';
import GitHistoryPanel from './GitHistoryPanel.svelte';
import { mountComponent } from './_testComponentMount';
import { queryCommits, resolveHistoryCommit } from '../git/gitService';
import type { CommitSummary } from '../git/types';
vi.mock('../git/gitService', () => ({ queryCommits: vi.fn(), resolveHistoryCommit: vi.fn() }));
vi.mock('../git/versionControlHistoryFilter', async original => ({ ...await original<typeof import('../git/versionControlHistoryFilter')>(), readPersistedHistoryFilterMode: vi.fn().mockResolvedValue(null), writePersistedHistoryFilterMode: vi.fn().mockResolvedValue(undefined) }));
const commit = (i: number): CommitSummary => ({ sha: i.toString(16).padStart(40,'0'), parents: [], refs: [], subject: `Commit ${i}`, authorName: 'Test Author', authorEmail: 'author@example.test', authorTime: 1700000000, committerName: 'Test Author', committerEmail: 'author@example.test', committerTime: 1700000000 });
async function settle() { for (let i=0;i<20;i++) { await Promise.resolve(); flushSync(); } }
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe(){} disconnect(){} }); vi.mocked(queryCommits).mockReset().mockResolvedValue([commit(1),commit(2)]); vi.mocked(resolveHistoryCommit).mockReset(); });
describe('mounted history table', () => {
  it('renders columns, leading badges, whole row selection, keyboard, resize and Changes', async () => {
    const first = { ...commit(1), refs: [{ type: 'currentBranchHead' as const, name: 'main' }] };
    vi.mocked(queryCommits).mockResolvedValue([first,commit(2)]);
    const onSelectCommit=vi.fn(), onOpenChanges=vi.fn();
    const selected=writable(first.sha), state=fromStore(selected);
    const view=mountComponent(GitHistoryPanel,{ repoRoot:'/repo', get selectedSha(){return state.current;}, onSelectCommit,onOpenChanges }); await settle();
    expect(view.host.querySelector('.git-history-header')?.textContent).toMatch(/Graph.*Description.*Commit.*Author.*Date/);
    const row=view.host.querySelector<HTMLButtonElement>('[role=option]')!;
    expect(row.textContent?.indexOf('main')).toBeLessThan(row.textContent!.indexOf('Commit 1'));
    expect(row.closest('.git-history-item')?.classList.contains('git-history-row-selected')).toBe(true);
    row.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})); await settle(); expect(onSelectCommit).toHaveBeenLastCalledWith(commit(2));
    const resize=view.host.querySelector<HTMLButtonElement>('[aria-label="Resize Author column"]')!;
    resize.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})); flushSync(); expect(view.host.querySelector('.git-history-table')?.getAttribute('style')).toContain('166px');
    view.host.querySelector<HTMLButtonElement>('.git-history-uncommitted')!.click(); expect(onOpenChanges).toHaveBeenCalled();
    expect(view.host.querySelector('.git-history-uncommitted')?.textContent).not.toContain(first.sha);
  });
  it('resolves Jump in the repo and opens ancestry outside the loaded page', async () => {
    const old=commit(9000); vi.mocked(resolveHistoryCommit).mockResolvedValue(old.sha);
    vi.mocked(queryCommits).mockImplementation(async (_root, options) => options?.revision === old.sha ? [old] : [commit(1)]);
    const onSelectCommit=vi.fn(); const view=mountComponent(GitHistoryPanel,{repoRoot:'/repo',onSelectCommit}); await settle();
    const input=view.host.querySelector<HTMLInputElement>('[aria-label="Jump to SHA or ref"]')!; input.value='old/ref'; input.dispatchEvent(new Event('input',{bubbles:true})); flushSync();
    view.host.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); await settle();
    expect(resolveHistoryCommit).toHaveBeenCalledWith('/repo','old/ref'); expect(queryCommits).toHaveBeenLastCalledWith('/repo',expect.objectContaining({revision:old.sha})); expect(onSelectCommit).toHaveBeenLastCalledWith(old);
  });
  it('preserves refresh scroll and selection and rejects old repository responses', async () => {
    const token=writable(0), state=fromStore(token), root=writable('/repo'), roots=fromStore(root);
    const onSelectCommit=vi.fn(), onClearSelection=vi.fn();
    const view=mountComponent(GitHistoryPanel,{get repoRoot(){return roots.current;},get refreshToken(){return state.current;},selectedSha:commit(2).sha,onSelectCommit,onClearSelection}); await settle();
    const scroll=view.host.querySelector<HTMLDivElement>('.git-history-scroll')!; scroll.scrollTop=80; scroll.dispatchEvent(new Event('scroll')); flushSync(); token.set(1); await settle(); expect(scroll.scrollTop).toBe(80); expect(onSelectCommit).not.toHaveBeenCalled();
    let resolve!: (rows:CommitSummary[])=>void; vi.mocked(queryCommits).mockImplementationOnce(()=>new Promise(r=>resolve=r)); token.set(2); flushSync();
    root.set('/new'); await settle(); resolve([commit(999)]); await settle(); expect(view.host.textContent).not.toContain('Commit 999'); expect(onClearSelection).toHaveBeenCalled();
  });
  it('windows large row sets and scales the graph geometry when density changes', async () => {
    const all=Array.from({length:5000},(_,i)=>commit(i+1));
    vi.mocked(queryCommits).mockImplementation(async (_root, options) => all.slice(options?.skip ?? 0, (options?.skip ?? 0) + (options?.limit ?? 500))); 
    const view=mountComponent(GitHistoryPanel,{repoRoot:'/repo'}); await settle();
    for(let page=0;page<9;page++) { Array.from(view.host.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent==='Load more commits')!.click(); await settle(); }
    expect(view.host.textContent).toContain('first 5000 commits');
    expect(view.host.querySelectorAll('[role=option]').length).toBeLessThan(5000);
    const svg=view.host.querySelector('svg')!; expect(svg.getAttribute('height')).toBe(String(5000*24));
    const checkbox=Array.from(view.host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')).at(-1)!; checkbox.checked=false; checkbox.dispatchEvent(new Event('change',{bubbles:true})); await settle(); expect(svg.getAttribute('height')).toBe(String(5000*26));
  });
  it('returns from a jump scope when sidebar revision changes and ignores a pending old jump', async () => {
    const ref=writable<string|null>(null), state=fromStore(ref);
    const view=mountComponent(GitHistoryPanel,{repoRoot:'/repo',get revision(){return state.current;}}); await settle();
    vi.mocked(resolveHistoryCommit).mockResolvedValue(commit(9000).sha);
    const submit=async () => { const input=view.host.querySelector<HTMLInputElement>('[aria-label="Jump to SHA or ref"]')!; input.value='old'; input.dispatchEvent(new Event('input',{bubbles:true})); flushSync(); view.host.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); await settle(); };
    await submit(); expect(queryCommits).toHaveBeenLastCalledWith('/repo',expect.objectContaining({revision:commit(9000).sha}));
    ref.set('refs/heads/next'); await settle(); expect(queryCommits).toHaveBeenLastCalledWith('/repo',expect.objectContaining({revision:'refs/heads/next'}));
    let resolve!: (sha:string)=>void; vi.mocked(resolveHistoryCommit).mockImplementationOnce(()=>new Promise(r=>resolve=r)); await submit();
    ref.set('refs/heads/final'); await settle(); resolve(commit(9999).sha); await settle();
    expect(queryCommits).toHaveBeenLastCalledWith('/repo',expect.objectContaining({revision:'refs/heads/final'}));
  });
  it('retains loaded depth on refresh and clears the inspector when a scope is empty', async () => {
    const token=writable(0), state=fromStore(token);
    vi.mocked(queryCommits).mockImplementation(async (_root, options) => Array.from({length:options?.limit ?? 500},(_,i)=>commit((options?.skip ?? 0)+i+1)));
    const onClearSelection=vi.fn(); const view=mountComponent(GitHistoryPanel,{repoRoot:'/repo',get refreshToken(){return state.current;},onClearSelection}); await settle();
    Array.from(view.host.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent==='Load more commits')!.click(); await settle();
    token.set(1); await settle(); expect(queryCommits).toHaveBeenLastCalledWith('/repo',expect.objectContaining({limit:1000}));
    onClearSelection.mockClear(); vi.mocked(queryCommits).mockResolvedValueOnce([]);
    view.host.querySelector<HTMLSelectElement>('[aria-label="History order"]')!.value='date'; view.host.querySelector('[aria-label="History order"]')!.dispatchEvent(new Event('change',{bubbles:true})); await settle();
    expect(onClearSelection).toHaveBeenCalled(); expect(view.host.querySelectorAll('[role=option]')).toHaveLength(0);
  });

});
