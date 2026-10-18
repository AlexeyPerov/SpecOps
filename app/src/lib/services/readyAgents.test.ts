import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { observeReadyAgents } from './readyAgents';
import { componentManager, listenComponentJobs } from './componentManager';
import { ensureAgentHostStarted } from './agentHostRuntime';
vi.mock('./componentManager', () => ({ componentManager: { list: vi.fn() }, listenComponentJobs: vi.fn() }));
const { authenticate, subscribeProfiles, profileCleanup, componentCleanup } = vi.hoisted(() => ({ authenticate: vi.fn(), subscribeProfiles: vi.fn(), profileCleanup: vi.fn(), componentCleanup: vi.fn() }));
vi.mock('./agentHostRuntime', () => ({ ensureAgentHostStarted: vi.fn().mockResolvedValue({}), getAgentHostClient: () => ({ authenticate, subscribeProfiles }) }));
let dispose: (() => void) | undefined;
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(componentManager.list).mockResolvedValue([]);
  vi.mocked(listenComponentJobs).mockResolvedValue(componentCleanup);
  subscribeProfiles.mockResolvedValue(profileCleanup);
  authenticate.mockResolvedValue({ profiles: [] });
});
afterEach(() => { dispose?.(); dispose = undefined; });
it('hides sessions on a fresh installation without starting the host', async () => {
  const changed = vi.fn(); dispose = observeReadyAgents(changed); await settle();
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(ensureAgentHostStarted).not.toHaveBeenCalled();
});
it('requires an active verified runtime and authenticated profile, and follows logout', async () => {
  vi.mocked(componentManager.list).mockResolvedValue([{ id: 'codex', active: true, verified: true }] as never);
  authenticate.mockResolvedValue({ profiles: [{ state: 'authenticated' }] });
  const changed = vi.fn(); dispose = observeReadyAgents(changed); await settle();
  expect(changed).toHaveBeenLastCalledWith(true);
  authenticate.mockResolvedValue({ profiles: [{ state: 'auth-required' }] });
  subscribeProfiles.mock.calls[0][0]({}); await settle();
  expect(changed).toHaveBeenLastCalledWith(false);
});
it('ignores installed components that are inactive or unverified', async () => {
  vi.mocked(componentManager.list).mockResolvedValue([{ id: 'codex', active: false, verified: true }, { id: 'claude', active: true, verified: false }] as never);
  const changed = vi.fn(); dispose = observeReadyAgents(changed); await settle();
  expect(changed).toHaveBeenLastCalledWith(false); expect(authenticate).not.toHaveBeenCalled();
});
it('rejects late refreshes and cleans up event subscriptions', async () => {
  let finish!: (value: never) => void;
  vi.mocked(componentManager.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const changed = vi.fn(); dispose = observeReadyAgents(changed); await settle();
  window.dispatchEvent(new Event('focus')); await settle();
  expect(changed).toHaveBeenLastCalledWith(false);
  finish([{ id: 'codex', active: true, verified: true }] as never); await settle();
  expect(ensureAgentHostStarted).not.toHaveBeenCalled();
  dispose(); dispose = undefined;
  expect(profileCleanup).toHaveBeenCalled(); expect(componentCleanup).toHaveBeenCalled();
});
it('treats host failure as unavailable', async () => {
  vi.mocked(componentManager.list).mockRejectedValueOnce(new Error('unavailable'));
  const changed = vi.fn(); dispose = observeReadyAgents(changed); await settle();
  expect(changed).toHaveBeenLastCalledWith(false);
});
