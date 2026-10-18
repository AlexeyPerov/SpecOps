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
  getProjectCatalog: vi.fn(() => ({ projects: {} })),
}));
import { addWorkspaceToWindow } from './addWorkspaceToWindow';
import { appState } from '../state/appState';
import { registerCatalogProjects, updateCatalogProject, getProjectCatalog, catalogProjectForRoot } from './workspaceCatalog';
import { focusExistingWorkspaceWindow } from './workspaceWindowTransfer';
import { setWorkspaceWindowOwner } from './workspaceWindowPlacement';
import { ensureWorkspaceReadAccess } from './fileSystem';
import { stat } from '@tauri-apps/plugin-fs';
beforeEach(() => {
  vi.clearAllMocks(); appState.resetAppState();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  vi.mocked(focusExistingWorkspaceWindow).mockResolvedValue(false);
  vi.mocked(setWorkspaceWindowOwner).mockResolvedValue(undefined);
  vi.mocked(registerCatalogProjects).mockResolvedValue({} as never);
  vi.mocked(ensureWorkspaceReadAccess).mockResolvedValue('ready');
  vi.mocked(stat).mockResolvedValue({ isDirectory: true } as never);
  vi.mocked(getProjectCatalog).mockReturnValue({ projects: {} } as never);
});
afterEach(() => vi.unstubAllGlobals());
describe('catalog workspace opening', () => {
  it('registers successfully opened paths with their own context identity', async () => {
    const id = await addWorkspaceToWindow('/project');
    expect(id).toMatch(/^ws-/);
    expect(registerCatalogProjects).toHaveBeenCalledWith(['/project']);
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(1);
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
  it('focuses the concurrent winner after a claim race', async () => {
    vi.mocked(focusExistingWorkspaceWindow).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.mocked(setWorkspaceWindowOwner).mockRejectedValueOnce(new Error('ownership changed'));
    expect(await addWorkspaceToWindow('/project')).toBeNull();
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
    expect(updateCatalogProject).not.toHaveBeenCalled();
  });
});
