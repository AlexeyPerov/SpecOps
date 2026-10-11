import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSinglePaneLayout, type WindowSessionSnapshot } from '../domain/contracts';
const disk = vi.hoisted(() => ({ data: undefined as string | undefined }));
vi.mock('@tauri-apps/api/path', () => ({ join: async (...parts: string[]) => parts.join('/') }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: async () => { if (disk.data === undefined) throw new Error('ENOENT'); return disk.data; } }));
vi.mock('./appDataDir', () => ({ ensureSpecOpsDataDir: async () => '/data' }));
vi.mock('./atomicWrite', () => ({ atomicWriteTextFile: async (_path: string, data: string) => { disk.data = data; } }));
vi.mock('./sessionWriteLock', () => ({ withSessionWriteLock: async (work: () => Promise<unknown>) => work() }));
import { filterWorkspacePlacement, setWorkspaceWindowOwner, workspaceWindowOwner } from './workspaceWindowPlacement';
const context = () => ({ documents: [], session: { editorLayout: createSinglePaneLayout([], null), lastActiveWindowId: 'source', windowBounds: null } });
const snapshot = (): WindowSessionSnapshot => ({ activeContextId: 'ws-1', notepad: context(), workspaces: [{ id: 'ws-1', rootPath: '/moved', snapshot: context() }, { id: 'ws-2', rootPath: '/remaining', snapshot: context() }], editorPreferences: { zoomPercent: 100, wrapLines: true } });
beforeEach(() => { disk.data = undefined; });
describe('durable workspace placement', () => {
  it('filters an old source crash record after commit and retains the destination record', async () => {
    await setWorkspaceWindowOwner('/moved', 'source', 'source');
    await setWorkspaceWindowOwner('/moved', 'target', 'source');
    const source = await filterWorkspacePlacement(snapshot(), 'source');
    expect(source.workspaces.map(entry => entry.rootPath)).toEqual(['/remaining']);
    expect(source.activeContextId).toBe('ws-2');
    expect((await filterWorkspacePlacement(snapshot(), 'target')).workspaces).toHaveLength(2);
  });
  it('does not overwrite a competing window claim and allows explicit close to release ownership', async () => {
    await setWorkspaceWindowOwner('/moved', 'target', null);
    await expect(setWorkspaceWindowOwner('/moved', 'other', null)).rejects.toThrow('ownership changed');
    expect(await workspaceWindowOwner('/moved')).toBe('target');
    await setWorkspaceWindowOwner('/moved', null);
    expect(await workspaceWindowOwner('/moved')).toBeUndefined();
  });
  it('refuses to replace corrupt ownership data', async () => {
    disk.data = '{broken';
    await expect(setWorkspaceWindowOwner('/moved', 'target')).rejects.toThrow();
    expect(disk.data).toBe('{broken');
  });
});
