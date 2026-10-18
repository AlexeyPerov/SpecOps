import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./diskFingerprint', () => ({
  normalizePathSync: (root: string) => root.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase(),
  normalizePathForStorage: (root: string) => root.replaceAll('\\', '/').replace(/\/$/, ''),
}));
import { invoke } from '@tauri-apps/api/core';
import { _resetWorkspacePreferencesForTests, getHiddenRootPaths, getWorkspaceDocumentStorage,
  isHiddenFromRail, loadWorkspacePreferences, setHiddenFromRail, setWorkspaceDocumentStorage,
  subscribeWorkspacePreferences } from './workspacePreferences';
import { catalogProjectForRoot } from './workspaceCatalog';
const invokeMock = vi.mocked(invoke);
function catalog(hidden = false, revision = 1) {
  return { version: 1, revision, projects: { '/projects/foo': { ...catalogProjectForRoot('/Projects/Foo'), hiddenFromRail: hidden, documentStorage: 'project' } }, folders: {}, savedContexts: {} };
}
beforeEach(() => { _resetWorkspacePreferencesForTests(); invokeMock.mockReset(); });
describe('catalog workspace preferences', () => {
  it('defaults to visible and application document storage before loading', () => {
    expect(getHiddenRootPaths().size).toBe(0);
    expect(isHiddenFromRail('/projects/foo')).toBe(false);
    expect(getWorkspaceDocumentStorage('/projects/foo')).toBe('app');
  });
  it('loads shared preferences from the catalog by normalized project identity', async () => {
    invokeMock.mockResolvedValue(catalog(true));
    expect(await loadWorkspacePreferences()).toEqual(new Set(['/projects/foo']));
    expect(isHiddenFromRail('/Projects/Foo/')).toBe(true);
    expect(getWorkspaceDocumentStorage('/projects/foo')).toBe('project');
  });
  it('registers and updates preferences in one transaction then notifies', async () => {
    invokeMock.mockResolvedValue(catalog(true));
    const seen = vi.fn();
    const off = subscribeWorkspacePreferences(seen);
    await setHiddenFromRail('/Projects/Foo', true);
    expect(invokeMock).toHaveBeenCalledWith('project_catalog_transaction', { mutations: [
      { type: 'register', project: catalogProjectForRoot('/Projects/Foo') },
      { type: 'updateProject', id: '/projects/foo', patch: { hiddenFromRail: true } },
    ] });
    expect(seen).toHaveBeenCalledWith(new Set(['/projects/foo']));
    off();
    await setHiddenFromRail('/projects/foo', true);
    expect(seen).toHaveBeenCalledTimes(1);
  });
  it('does not publish failed preference writes', async () => {
    invokeMock.mockResolvedValueOnce(catalog(false));
    await loadWorkspacePreferences();
    const seen = vi.fn(); subscribeWorkspacePreferences(seen);
    invokeMock.mockRejectedValueOnce(new Error('disk full'));
    await expect(setHiddenFromRail('/projects/foo', true)).rejects.toThrow('disk full');
    expect(isHiddenFromRail('/projects/foo')).toBe(false);
    expect(seen).not.toHaveBeenCalled();
  });
  it('uses the same catalog transaction for document storage', async () => {
    invokeMock.mockResolvedValue(catalog());
    await setWorkspaceDocumentStorage('/projects/foo', 'project');
    expect(invokeMock.mock.calls[0][1]).toMatchObject({ mutations: [
      { type: 'register' }, { type: 'updateProject', patch: { documentStorage: 'project' } },
    ] });
  });
  it('surfaces invalid/unrecoverable catalog reads instead of silently resetting', async () => {
    invokeMock.mockRejectedValue(new Error('Invalid project catalog'));
    await expect(loadWorkspacePreferences()).rejects.toThrow('Invalid project catalog');
  });
});
