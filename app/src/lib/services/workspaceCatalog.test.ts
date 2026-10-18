import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { _resetProjectCatalogForTests, catalogProjectForRoot, getProjectCatalog, listenProjectCatalogChanges,
  loadProjectCatalog, registerCatalogProjects, subscribeProjectCatalog, updateCatalogProject } from './workspaceCatalog';
const response = (revision: number) => ({ version: 1, revision, projects: {}, folders: {}, savedContexts: {} });
beforeEach(() => { _resetProjectCatalogForTests(); vi.mocked(invoke).mockReset(); });
describe('project catalog frontend', () => {
  it('ignores stale local responses after a newer cross-window read', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = loadProjectCatalog();
    vi.mocked(invoke).mockResolvedValueOnce(response(3));
    await loadProjectCatalog();
    finish(response(2)); await pending;
    expect(getProjectCatalog().revision).toBe(3);
  });
  it('keeps caller snapshots detached from the committed cache', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(response(1));
    await loadProjectCatalog();
    const copy = getProjectCatalog(); copy.revision = 99;
    expect(getProjectCatalog().revision).toBe(1);
  });
  it('notifies only after successful commit and preserves the old snapshot on failure', async () => {
    const subscriber = vi.fn(); subscribeProjectCatalog(subscriber);
    vi.mocked(invoke).mockRejectedValueOnce(new Error('lock unavailable'));
    await expect(registerCatalogProjects(['/a'])).rejects.toThrow('lock unavailable');
    expect(subscriber).not.toHaveBeenCalled();
    expect(getProjectCatalog().revision).toBe(0);
  });
  it('batches multi-add and uses normalized identities without context ids', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(response(1));
    await registerCatalogProjects(['/a/', '/b']);
    expect(invoke).toHaveBeenCalledWith('project_catalog_transaction', { mutations: [
      { type: 'register', project: catalogProjectForRoot('/a/') },
      { type: 'register', project: catalogProjectForRoot('/b') },
    ] });
  });
  it('supports clearing optional appearance settings', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(response(1));
    await updateCatalogProject('/a', { color: null, icon: null });
    expect(invoke).toHaveBeenCalledWith('project_catalog_transaction', expect.objectContaining({ mutations: expect.arrayContaining([
      { type: 'updateProject', id: catalogProjectForRoot('/a').id, patch: { color: null, icon: null } },
    ]) }));
  });
  it('loads committed changes from another window and skips known revisions', async () => {
    await listenProjectCatalogChanges();
    const handler = vi.mocked(listen).mock.calls.at(-1)![1];
    vi.mocked(invoke).mockResolvedValue(response(4));
    handler({ event: 'spec-ops/project-catalog-changed', id: 1, payload: 4 });
    await vi.waitFor(() => expect(getProjectCatalog().revision).toBe(4));
    vi.mocked(invoke).mockClear();
    handler({ event: 'spec-ops/project-catalog-changed', id: 1, payload: 4 });
    expect(invoke).not.toHaveBeenCalled();
  });
});
