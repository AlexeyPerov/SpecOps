import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import WorkspaceSwitcherPickerHarness from './WorkspaceSwitcherPicker.harness.svelte';
import { mountComponent } from './_testComponentMount';
import { appState } from '../state/appState';
import { catalogProjectForRoot, _resetProjectCatalogForTests } from '../services/workspaceCatalog';
import { invoke } from '@tauri-apps/api/core';
import { addWorkspaceToWindow } from '../services/addWorkspaceToWindow';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../services/addWorkspaceToWindow', () => ({ addWorkspaceToWindow: vi.fn().mockResolvedValue(null) }));
vi.mock('../services/workspaceWindowPlacement', () => ({ readLiveWorkspaceWindowOwners: vi.fn().mockResolvedValue({ '/remote': 'other' }) }));
const flush = async () => { await tick(); await new Promise(resolve => setTimeout(resolve, 0)); await tick(); };
function key(element: Element, value: string) { element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); }
beforeEach(() => {
  appState.resetAppState(); _resetProjectCatalogForTests(); vi.clearAllMocks();
  vi.mocked(addWorkspaceToWindow).mockResolvedValue(null);
  const hidden = { ...catalogProjectForRoot('/hidden'), name: 'Hidden app', hiddenFromRail: true, folderId: 'team', lastUsedAt: '2026-01-01' };
  const remote = { ...catalogProjectForRoot('/remote'), name: 'Remote app', lastUsedAt: '2026-02-01' };
  vi.mocked(invoke).mockResolvedValue({ version: 1, revision: 1, projects: { [hidden.id]: hidden, [remote.id]: remote }, folders: { team: { id: 'team', name: 'Team', order: 0 } }, savedContexts: {} });
});
describe('workspace switcher', () => {
  it('includes hidden and other-window projects, ranks recency, navigates, and restores focus on Escape', async () => {
    const active = appState.addWorkspace('/local');
    const { host } = mountComponent(WorkspaceSwitcherPickerHarness, {});
    const opener = host.querySelector<HTMLButtonElement>('.opener')!; opener.focus(); opener.click(); await flush();
    expect(appState.getSnapshot().contexts.activeContextId).toBe(active);
    const options = host.querySelectorAll('[role=option]');
    expect(options[0].textContent).toContain('Remote app'); expect(options[0].textContent).toContain('Another window');
    expect(host.textContent).toContain('Team · Closed · Hidden');
    const input = host.querySelector<HTMLInputElement>('[role=combobox]')!;
    expect(document.activeElement).toBe(input);
    key(input, 'ArrowDown'); await tick(); expect(input.getAttribute('aria-activedescendant')).toContain('-1');
    key(input, 'Escape'); await flush(); expect(host.querySelector('[role=dialog]')).toBeNull(); expect(document.activeElement).toBe(opener);
    expect(addWorkspaceToWindow).not.toHaveBeenCalled();
  });
  it('filters locally and opens the selected owner through the existing activation flow', async () => {
    const { host } = mountComponent(WorkspaceSwitcherPickerHarness, {});
    host.querySelector<HTMLButtonElement>('.opener')!.click(); await flush();
    const calls = vi.mocked(invoke).mock.calls.length;
    const input = host.querySelector<HTMLInputElement>('[role=combobox]')!; input.value = 'remote'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    expect(host.querySelectorAll('[role=option]')).toHaveLength(1); expect(invoke).toHaveBeenCalledTimes(calls);
    key(input, 'Enter'); await flush(); expect(addWorkspaceToWindow).toHaveBeenCalledExactlyOnceWith('/remote'); expect(host.querySelector('[role=dialog]')).toBeNull();
  });
  it('keeps unavailable projects and errors visible without activating a workspace', async () => {
    vi.mocked(addWorkspaceToWindow).mockRejectedValue(new Error('Directory unavailable'));
    const { host } = mountComponent(WorkspaceSwitcherPickerHarness, {}); host.querySelector<HTMLButtonElement>('.opener')!.click(); await flush();
    key(host.querySelector('[role=combobox]')!, 'Enter'); await flush();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Directory unavailable'); expect(host.querySelector('[role=dialog]')).not.toBeNull();
    expect(appState.getWorkspaceActivationHistory()).toEqual([]);
  });
});
