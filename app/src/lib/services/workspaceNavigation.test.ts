import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../state/appState';
import { activatePreviousWorkspace } from './workspaceNavigation';
import { dispatchCommand, keymapCommandForEvent } from '../commands/registry';
import { ensureWorkspaceReadAccess } from './fileSystem';
import { stat } from '@tauri-apps/plugin-fs';
import { commandDefinitions } from '../commands/definitions';
import { findKeymapConflict } from '../commands/commandBindings';
vi.mock('./fileSystem', () => ({ ensureWorkspaceReadAccess: vi.fn().mockResolvedValue('ready') }));
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn().mockResolvedValue({ isDirectory: true }) }));
beforeEach(() => { appState.resetAppState(); vi.clearAllMocks(); });
describe('successful workspace activation history', () => {
  it('toggles successful open contexts and ignores Manager and plain Notepad switches', async () => {
    const first = appState.addWorkspace('/first')!, second = appState.addWorkspace('/second')!;
    appState.switchContext('notepad'); appState.openOrFocusViewTab('workspace-manager');
    await activatePreviousWorkspace(vi.fn());
    expect(appState.getSnapshot().contexts.activeContextId).toBe(first);
    await activatePreviousWorkspace(vi.fn());
    expect(appState.getSnapshot().contexts.activeContextId).toBe(second);
  });
  it('does not count provisional additions or failed activations and prunes closed ids', () => {
    const first = appState.addWorkspace('/first')!, second = appState.addWorkspace('/second')!;
    const provisional = appState.addWorkspace('/failed', { deferActivation: true })!;
    expect(appState.getWorkspaceActivationHistory()).toEqual([second, first]);
    appState.closeWorkspace(provisional, { deferActivation: true }); appState.switchContext(second);
    expect(appState.getWorkspaceActivationHistory()).toEqual([second, first]);
    appState.switchContext('ws-999'); expect(appState.getWorkspaceActivationHistory()).toEqual([second, first]);
    appState.closeWorkspace(first); expect(appState.getWorkspaceActivationHistory()).toEqual([second]);
  });
  it('records the real successor when closing the active context', () => {
    const first = appState.addWorkspace('/first')!, second = appState.addWorkspace('/second')!, third = appState.addWorkspace('/third')!;
    appState.closeWorkspace(third);
    expect(appState.getSnapshot().contexts.activeContextId).toBe(first);
    expect(appState.getWorkspaceActivationHistory()).toEqual([first, second]);
  });
  it('records a confirmed new context only after commit', () => {
    const first = appState.addWorkspace('/first')!;
    const next = appState.addWorkspace('/next', { deferActivation: true })!;
    expect(appState.getWorkspaceActivationHistory()).toEqual([first]);
    appState.confirmWorkspaceActivation(next);
    expect(appState.getWorkspaceActivationHistory()).toEqual([next, first]);
  });
  it('skips unavailable open contexts without recording them', async () => {
    const first = appState.addWorkspace('/first')!, inaccessible = appState.addWorkspace('/gone')!, current = appState.addWorkspace('/current')!;
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.mocked(ensureWorkspaceReadAccess).mockImplementation(async root => root === '/gone' ? 'blocked' : 'ready');
    try { await activatePreviousWorkspace(vi.fn()); } finally { vi.unstubAllGlobals(); }
    expect(appState.getSnapshot().contexts.activeContextId).toBe(first);
    expect(appState.getWorkspaceActivationHistory()).toEqual([first, current, inaccessible]);
    expect(stat).toHaveBeenCalledWith('/first');
  });
  it('dispatches the switch command and keeps shortcuts conflict-free on both platforms', () => {
    const openWorkspaceSwitcher = vi.fn();
    dispatchCommand('workspace.switch', { openWorkspaceSwitcher } as never);
    expect(openWorkspaceSwitcher).toHaveBeenCalledOnce();
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      expect(keymapCommandForEvent(new KeyboardEvent('keydown', { key: 'p', altKey: true, ...modifier }))).toBe('workspace.switch');
      expect(keymapCommandForEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, ...modifier }))).toBe('workspace.previous');
    }
    for (const id of ['workspace.switch', 'workspace.previous'] as const) {
      const definition = commandDefinitions.find(entry => entry.id === id)!;
      for (const platform of ['mac', 'windows'] as const) expect(findKeymapConflict(commandDefinitions, id, definition.binding![platform], platform)).toBeNull();
    }
  });
  it('dispatches previous and reports when no accessible previous context remains', async () => {
    appState.addWorkspace('/only'); const notify = vi.fn();
    await dispatchCommand('workspace.previous', { notify } as never);
    expect(notify).toHaveBeenCalledWith('No previous accessible workspace is open in this window.');
  });
});
