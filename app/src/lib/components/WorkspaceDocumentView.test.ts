import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
const document = vi.hoisted(() => ({ record: { root: '/project', kind: 'tasks', storage: 'app', path: '/data/tasks.json', content: '# Tasks\n- [ ] First\n- [x] Second\n', saved: '', loading: false, saving: false, error: null }, edit: vi.fn() }));
vi.mock('../services/workspacePreferences', async () => ({ ...await vi.importActual('../services/workspacePreferences'), getWorkspaceDocumentStorage: () => 'app', subscribeWorkspacePreferences: (listener: () => void) => { listener(); return () => {}; } }));
vi.mock('../services/workspaceDocuments', async () => {
  const { writable } = await import('svelte/store'); const revision = writable(0);
  return { documentStorage: () => 'app', createWorkspaceDocument: vi.fn(), refreshDocument: vi.fn(), workspaceDocumentsRevision: revision, workspaceDocumentSnapshot: () => document.record, loadWorkspaceDocument: async () => document.record,
    editWorkspaceDocument: (_record: unknown, content: string) => { document.edit(content); document.record.content = content; revision.update(value => value + 1); },
    saveWorkspaceDocument: async () => {}, reloadWorkspaceDocument: async () => {},
  };
});
import { serializeTaskBook, type TaskBook } from '../services/workspaceTasks';
import { workspaceDocumentsRevision } from '../services/workspaceDocuments';
import WorkspaceDocumentView from './WorkspaceDocumentView.svelte';
let view: ReturnType<typeof mount> | undefined;
let target: HTMLElement;
afterEach(async () => { if (view) await unmount(view); view = undefined; target?.remove(); });
async function render(kind: 'tasks' | 'notes', root: string | null = '/project') {
  target = window.document.createElement('div'); window.document.body.append(target);
  view = mount(WorkspaceDocumentView, { target, props: { root, kind, contextId: root === null ? 'notepad' : 'ws-1', paneId: 'pane-1', notify: vi.fn() } });
  await tick();
}
describe('workspace document views', () => {
  it('updates completion and order in structured tasks', async () => {
    const book: TaskBook = { version: 1, groups: [], lists: [{ id: 'list', title: 'Work', groupId: null }], tasks: [
      { id: 'a', listId: 'list', text: 'First', completed: false }, { id: 'b', listId: 'list', text: 'Second', completed: true },
    ] };
    document.record.content = serializeTaskBook(book);
    await render('tasks');
    const first = target.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    first.checked = true; first.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    expect(JSON.parse(document.record.content).tasks[0].completed).toBe(true);
    target.querySelector<HTMLButtonElement>('button[aria-label="Move task down"]')!.click(); await tick();
    expect(JSON.parse(document.record.content).tasks.map((task: { id: string }) => task.id)).toEqual(['b', 'a']);
  });
  it('creates groups, lists and tasks and undoes list deletion with its contents', async () => {
    document.record.content = serializeTaskBook({ version: 1, groups: [], lists: [], tasks: [] });
    await render('tasks', null);
    expect(target.querySelector('header strong')?.textContent).toBe('Global Tasks');
    async function submit(label: string, value: string) {
      const input = target.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
      input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await tick();
    }
    await submit('New group', 'Release');
    const group = JSON.parse(document.record.content).groups[0];
    const select = target.querySelector<HTMLSelectElement>('[aria-label="Group for new list"]')!;
    select.value = group.id; select.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    await submit('New list', 'Checks');
    await submit('New task', 'Verify build');
    const before = document.record.content;
    expect(JSON.parse(before).lists[0].groupId).toBe(group.id);
    [...target.querySelectorAll('button')].find(button => button.textContent === 'Delete list')!.click(); await tick();
    expect(JSON.parse(document.record.content).tasks).toEqual([]);
    [...target.querySelectorAll('button')].find(button => button.textContent === 'Undo deletion')!.click(); await tick();
    expect(document.record.content).toBe(before);
    expect(target.querySelector<HTMLInputElement>('[aria-label="Task text"]')?.value).toBe('Verify build');
  });
  it('filters tasks and moves a task between lists without replacing its ID', async () => {
    document.record.content = serializeTaskBook({ version: 1, groups: [], lists: [
      { id: 'a', title: 'Work', groupId: null }, { id: 'b', title: 'Later', groupId: null },
    ], tasks: [{ id: 't', listId: 'a', text: 'Ship', completed: false }] });
    await render('tasks');
    const filter = target.querySelector<HTMLSelectElement>('[aria-label="Task status"]')!;
    filter.value = 'completed'; filter.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    expect(target.querySelector('[aria-label="Task text"]')).toBeNull();
    filter.value = 'all'; filter.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    const move = target.querySelector<HTMLSelectElement>('[aria-label="List for Ship"]')!;
    move.value = 'b'; move.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    expect(JSON.parse(document.record.content).tasks[0]).toMatchObject({ id: 't', listId: 'b' });
    expect(target.querySelector('[aria-label="Task text"]')).toBeNull();
  });
  it('keeps the selected list and input draft during a clean background reread', async () => {
    document.record.content = serializeTaskBook({ version: 1, groups: [], lists: [
      { id: 'first', title: 'First', groupId: null }, { id: 'later', title: 'Later', groupId: null },
    ], tasks: [] });
    await render('tasks');
    target.querySelectorAll<HTMLButtonElement>('.list-link')[1].click(); await tick();
    const input = target.querySelector<HTMLInputElement>('[aria-label="New task"]')!;
    input.value = 'Unsubmitted task'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    document.record.loading = true; workspaceDocumentsRevision.update(value => value + 1); await tick();
    expect(target.querySelector<HTMLInputElement>('[aria-label="List name"]')?.value).toBe('Later');
    expect(target.querySelector<HTMLInputElement>('[aria-label="New task"]')?.value).toBe('Unsubmitted task');
    document.record.loading = false; workspaceDocumentsRevision.update(value => value + 1); await tick();
  });
  it('keeps corrupt JSON unchanged and offers an explicit refresh', async () => {
    document.record.content = '{invalid'; document.edit.mockClear();
    await render('tasks');
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('kept unchanged');
    expect(document.edit).not.toHaveBeenCalled();
    expect([...target.querySelectorAll('button')].some(button => button.textContent === 'Refresh')).toBe(true);
  });
  it('renders notes Markdown and removes executable HTML from the preview', async () => {
    document.record.content = '# Notes\n<script>alert(1)</script><img src="https://example.com/image.png" onerror="alert(1)">\n**Hello**';
    await render('notes');
    const preview = target.querySelector('.preview')!;
    expect(preview.querySelector('h1')?.textContent).toBe('Notes');
    expect(preview.querySelector('strong')?.textContent).toBe('Hello');
    expect(preview.querySelector('script')).toBeNull();
    expect(preview.querySelector('img')?.hasAttribute('onerror')).toBe(false);
  });
});
