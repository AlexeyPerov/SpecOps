import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { mountComponent } from './_testComponentMount';
import NativeExtensionsPanel from './NativeExtensionsPanel.svelte';
const mocks = vi.hoisted(() => ({ discover: vi.fn(), inspect: vi.fn(), action: vi.fn(), cancel: vi.fn() }));
vi.mock('../services/agentHostRuntime', () => ({ ensureAgentHostStarted: async () => {}, getAgentHostClient: () => ({ discover: mocks.discover, inspectNative: mocks.inspect, cancelTurn: mocks.cancel }) }));
vi.mock('../services/nativeExtensions', () => ({ extensionSession: () => ({ runtimeId: 'opencode', connectionProfileId: 'profile', nativeSessionId: 'native' }), performNativeAction: mocks.action }));
async function settle() { await Promise.resolve(); await tick(); await Promise.resolve(); await tick(); }
function button(host: HTMLElement, text: string) { return [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!; }
beforeEach(() => {
  mocks.discover.mockReset().mockResolvedValue({ runtimes: [{ id: 'opencode', capabilities: { supported: ['nativeExtensions'] } }] });
  mocks.inspect.mockReset().mockResolvedValue({ generation: 1, scope: 'Selected profile', actions: ['share','revokeShare','revert'], rows: [{ id: 'task', label: 'Review', detail: 'status: pending' }] });
  mocks.action.mockReset().mockResolvedValue({ generation: 1 });
});
describe('neutral native extension UI', () => {
  it('absence sends no native view/action request, refresh failures leave explicit unavailable state', async () => {
    mocks.discover.mockResolvedValue({ runtimes: [] });
    const { host } = mountComponent(NativeExtensionsPanel, { root: '/workspace', sessionId: 'session' }); await settle();
    button(host, 'Refresh').click(); await settle();
    expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.action).not.toHaveBeenCalled(); expect(host.textContent).toContain('unavailable');
  });
  it('renders statuses and gates explicit native publishing/revoke and checkpoint target', async () => {
    const { host } = mountComponent(NativeExtensionsPanel, { root: '/workspace', sessionId: 'session' }); await settle();
    button(host, 'Refresh').click(); await settle();
    expect(host.textContent).toContain('status: pending');
    expect(button(host, 'Revert').disabled).toBe(true);
    button(host, 'Publish').click(); await settle();
    expect(mocks.action).toHaveBeenCalledWith('/workspace', 'session', 'share', undefined, expect.any(Function));
    button(host, 'Revoke').click(); await settle();
    expect(mocks.action).toHaveBeenCalledWith('/workspace', 'session', 'revokeShare', undefined, expect.any(Function));
  });
});

it('compact requires explicit usage confirmation, shows observed native progress and provides only its owned Stop', async () => {
  mocks.inspect.mockResolvedValue({ generation: 1, scope: 'Native conversation only; rollback unavailable', actions: ['compact'], rows: [] });
  mocks.cancel.mockReset().mockResolvedValue(undefined);
  const { host } = mountComponent(NativeExtensionsPanel, { root: '/workspace', sessionId: 'session' }); await settle();
  button(host, 'Refresh').click(); await settle();
  expect(button(host, 'Stop')).toBeUndefined();
  button(host, 'Compact').click(); await settle(); expect(mocks.action).not.toHaveBeenCalled(); expect(host.textContent).toContain('may incur usage');
  let finish!: (value: unknown) => void;
  mocks.action.mockImplementation((_root, _session, _action, _target, progress) => { progress({ generation: 1, scope: 'Native', actions: ['compact'], rows: [], operation: { status: 'running', detail: 'Native context compaction started.' } }); return new Promise(resolve => { finish = resolve; }); });
  button(host, 'Compact').click(); await settle(); expect(host.textContent).toContain('Native context compaction started.');
  button(host, 'Stop').click(); await settle(); expect(mocks.cancel).toHaveBeenCalledTimes(1);
  finish({ generation: 1 }); await settle(); expect(button(host, 'Stop')).toBeUndefined();
});
