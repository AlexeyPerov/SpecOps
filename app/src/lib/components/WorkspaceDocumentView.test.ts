import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
const document = vi.hoisted(() => ({ record: { root: '/project', kind: 'tasks', storage: 'app', path: '/data/tasks.md', content: '# Tasks\n- [ ] First\n- [x] Second\n', saved: '', loading: false, saving: false, error: null }, edit: vi.fn() }));
vi.mock('../services/workspacePreferences', async () => ({ ...await vi.importActual('../services/workspacePreferences'), getWorkspaceDocumentStorage: () => 'app', subscribeWorkspacePreferences: (listener: () => void) => { listener(); return () => {}; } }));
vi.mock('../services/workspaceDocuments', async () => {
  const { writable } = await import('svelte/store'); const revision = writable(0);
  return { workspaceDocumentsRevision: revision, workspaceDocumentSnapshot: () => document.record, loadWorkspaceDocument: async () => document.record,
    editWorkspaceDocument: (_record: unknown, content: string) => { document.edit(content); document.record.content = content; revision.update(value => value + 1); },
    saveWorkspaceDocument: async () => {}, reloadWorkspaceDocument: async () => {},
  };
});
import WorkspaceDocumentView from './WorkspaceDocumentView.svelte';
let view: ReturnType<typeof mount> | undefined;
let target: HTMLElement;
afterEach(async () => { if (view) await unmount(view); view = undefined; target?.remove(); });
async function render(kind: 'tasks' | 'notes') {
  target = window.document.createElement('div'); window.document.body.append(target);
  view = mount(WorkspaceDocumentView, { target, props: { root: '/project', kind, contextId: 'ws-1', paneId: 'pane-1', notify: vi.fn() } });
  await tick();
}
describe('workspace document views', () => {
  it('updates Markdown through checkboxes and task reorder while retaining the heading', async () => {
    document.record.content = '# Tasks\n- [ ] First\n- [x] Second\n';
    await render('tasks');
    const first = target.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    first.checked = true; first.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    expect(document.record.content).toBe('# Tasks\n- [x] First\n- [x] Second\n');
    target.querySelector<HTMLButtonElement>('button[aria-label="Move task down"]')!.click(); await tick();
    expect(document.record.content).toBe('# Tasks\n- [x] Second\n- [x] First\n');
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
