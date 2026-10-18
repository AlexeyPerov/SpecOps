vi.mock('./workspaceSavedContext', () => ({restoreSavedProjectContext:vi.fn().mockResolvedValue(null)}));
import { restoreSavedProjectContext } from './workspaceSavedContext';
import { setWorkspaceContextClosing } from './workspaceContextTransition';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: () => ({ label: 'current' }) }));
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn().mockResolvedValue({ isDirectory: true }) }));
vi.mock('./fileSystem', () => ({ ensureWorkspaceReadAccess: vi.fn().mockResolvedValue('ready') }));
vi.mock('./workspaceWindowTransfer', () => ({ focusExistingWorkspaceWindow: vi.fn().mockResolvedValue(false) }));
vi.mock('./workspaceWindowPlacement', () => ({ markWorkspaceOutgoing: vi.fn(), setWorkspaceWindowOwner: vi.fn().mockResolvedValue(undefined), workspaceWindowOwner: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./workspaceCatalog', async importOriginal => ({
  ...await importOriginal<typeof import('./workspaceCatalog')>(),
  registerCatalogProjects: vi.fn().mockResolvedValue(undefined),
  loadProjectCatalog: vi.fn().mockResolvedValue(undefined),
  updateCatalogProject: vi.fn().mockResolvedValue(undefined),
  getProjectCatalog: vi.fn(() => ({ projects: {}, savedContexts: {} })),
}));
import { isWorkspaceLifecycleActive, resetWorkspaceLifecycleForTests } from './workspaceLifecycle';
import { addWorkspaceToWindow } from './addWorkspaceToWindow';
import { appState } from '../state/appState';
import { registerCatalogProjects, updateCatalogProject, getProjectCatalog, catalogProjectForRoot } from './workspaceCatalog';
import { focusExistingWorkspaceWindow } from './workspaceWindowTransfer';
import { setWorkspaceWindowOwner } from './workspaceWindowPlacement';
import { ensureWorkspaceReadAccess } from './fileSystem';
import { stat } from '@tauri-apps/plugin-fs';
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(restoreSavedProjectContext).mockReset().mockResolvedValue(null); appState.resetAppState(); resetWorkspaceLifecycleForTests();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  vi.mocked(focusExistingWorkspaceWindow).mockResolvedValue(false);
  vi.mocked(setWorkspaceWindowOwner).mockResolvedValue(undefined);
  vi.mocked(registerCatalogProjects).mockResolvedValue({} as never);
  vi.mocked(ensureWorkspaceReadAccess).mockResolvedValue('ready');
  vi.mocked(stat).mockResolvedValue({ isDirectory: true } as never);
  vi.mocked(getProjectCatalog).mockReturnValue({ projects: {}, savedContexts: {} } as never);
});
afterEach(() => vi.unstubAllGlobals());
describe('catalog workspace opening', () => {
  it('registers successfully opened paths with their own context identity', async () => {
    const id = await addWorkspaceToWindow('/project');
    expect(id).toMatch(/^ws-/);
    expect(registerCatalogProjects).toHaveBeenCalledWith(['/project']);
    expect(isWorkspaceLifecycleActive()).toBe(true);
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(1);
  });
  it('coalesces concurrent normalized-root saved-context restores into one owned context', async () => {
    const snapshot = structuredClone(appState.getWindowSessionSnapshot().notepad);
    let release!: (value: NonNullable<Awaited<ReturnType<typeof restoreSavedProjectContext>>>) => void;
    vi.mocked(restoreSavedProjectContext).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = addWorkspaceToWindow('/project'), second = addWorkspaceToWindow('/project/');
    expect(first).toBe(second);
    await vi.waitFor(() => expect(restoreSavedProjectContext).toHaveBeenCalledTimes(1));
    release(snapshot);
    const [a,b] = await Promise.all([first,second]);
    expect(a).toBe(b); expect(a).toMatch(/^ws-/);
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(1);
    expect(setWorkspaceWindowOwner).toHaveBeenCalledTimes(1);
  });
  it('focuses an occupied window without creating a competing context', async () => {
    vi.mocked(focusExistingWorkspaceWindow).mockResolvedValue(true);
    expect(await addWorkspaceToWindow('/project')).toBeNull();
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
    expect(registerCatalogProjects).not.toHaveBeenCalled();
  });
  it('keeps catalog write failures from creating an open context', async () => {
    vi.mocked(registerCatalogProjects).mockRejectedValueOnce(new Error('disk full'));
    await expect(addWorkspaceToWindow('/project')).rejects.toThrow('disk full');
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
  });
  it('rolls back the open context when the ownership claim fails', async () => {
    vi.mocked(setWorkspaceWindowOwner).mockRejectedValueOnce(new Error('claim failed'));
    await expect(addWorkspaceToWindow('/project')).rejects.toThrow('claim failed');
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
    expect(updateCatalogProject).toHaveBeenCalledWith('/project', { openError: 'Error: claim failed' });
  });
  it('preserves the last successful activation after a provisional claim rolls back', async () => {
    const first = appState.addWorkspace('/first')!, current = appState.addWorkspace('/current')!;
    vi.mocked(setWorkspaceWindowOwner).mockRejectedValueOnce(new Error('claim failed'));
    await expect(addWorkspaceToWindow('/failed')).rejects.toThrow('claim failed');
    expect(appState.getSnapshot().contexts.activeContextId).toBe(current);
    expect(appState.getWorkspaceActivationHistory()).toEqual([current, first]);
    expect(isWorkspaceLifecycleActive()).toBe(false);
    expect(vi.mocked(updateCatalogProject).mock.calls.some(([,patch]) => 'lastUsedAt' in patch)).toBe(false);
  });
  it('refuses to activate an inaccessible existing local context', async () => {
    const id = appState.addWorkspace('/project')!; appState.switchContext('notepad');
    vi.mocked(stat).mockRejectedValueOnce(new Error('missing'));
    await expect(addWorkspaceToWindow('/project')).rejects.toThrow('missing');
    expect(appState.getSnapshot().contexts.activeContextId).toBe('notepad');
    expect(appState.getWorkspaceActivationHistory()).toEqual([id]);
  });
  it('keeps previously registered unavailable projects with an explanatory error', async () => {
    const project = catalogProjectForRoot('/project');
    vi.mocked(getProjectCatalog).mockReturnValue({ projects: { [project.id]: project } } as never);
    vi.mocked(stat).mockRejectedValueOnce(new Error('Directory missing'));
    await expect(addWorkspaceToWindow('/project')).rejects.toThrow('Directory missing');
    expect(registerCatalogProjects).not.toHaveBeenCalled();
    expect(updateCatalogProject).toHaveBeenCalledWith('/project', { openError: 'Error: Directory missing' });
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
  });
  it('does not register a new inaccessible path', async () => {
    vi.mocked(ensureWorkspaceReadAccess).mockResolvedValue('blocked');
    await expect(addWorkspaceToWindow('/missing')).rejects.toThrow('inaccessible');
    expect(registerCatalogProjects).not.toHaveBeenCalled();
    expect(updateCatalogProject).not.toHaveBeenCalled();
  });
  it('activates a local duplicate without creating a second context', async () => {
    const id = appState.addWorkspace('/project/')!;
    appState.switchContext('notepad');
    expect(await addWorkspaceToWindow('/project')).toBeNull();
    expect(appState.getSnapshot().contexts.activeContextId).toBe(id);
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(1);
  });
  it('clears a recovered local path error before successfully activating it', async () => {
    const id = appState.addWorkspace('/project')!; appState.switchContext('notepad');
    const project = { ...catalogProjectForRoot('/project'), openError: 'missing' };
    vi.mocked(getProjectCatalog).mockReturnValue({ projects: { [project.id]: project } } as never);
    await addWorkspaceToWindow('/project');
    expect(appState.getSnapshot().contexts.activeContextId).toBe(id);
    expect(updateCatalogProject).toHaveBeenCalledWith('/project', { openError: null });
    expect(updateCatalogProject).toHaveBeenCalledWith('/project', { lastUsedAt: expect.any(String) });
  });
  it('focuses the concurrent winner after a claim race', async () => {
    vi.mocked(focusExistingWorkspaceWindow).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.mocked(setWorkspaceWindowOwner).mockRejectedValueOnce(new Error('ownership changed'));
    expect(await addWorkspaceToWindow('/project')).toBeNull();
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
    expect(updateCatalogProject).not.toHaveBeenCalled();
    expect(setWorkspaceWindowOwner).toHaveBeenCalledTimes(1);
    expect(setWorkspaceWindowOwner).not.toHaveBeenCalledWith('/project',null,'current');
  });
  it('does not reopen a root while its close is still committing', async () => {
    setWorkspaceContextClosing('/project',true);
    try { await expect(addWorkspaceToWindow('/project')).rejects.toThrow('still closing'); }
    finally {setWorkspaceContextClosing('/project',false);}
    expect(registerCatalogProjects).not.toHaveBeenCalled();
    expect(appState.getWindowSessionSnapshot().workspaces).toHaveLength(0);
  });

});
