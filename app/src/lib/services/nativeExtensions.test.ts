import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ root: '/workspace', start: vi.fn(), action: vi.fn(), resume: vi.fn(), link: vi.fn(), setLink: vi.fn(), thread: vi.fn(), messages: vi.fn(), flush: vi.fn(), persist: vi.fn(), active: vi.fn(), refresh: vi.fn() }));
vi.mock('../state/chatStore', async () => { const { writable } = await import('svelte/store'); return { chatIsGenerating: writable(false), chatStore: { getActiveChatScopeKey: () => mocks.root, getSessionLink: mocks.link, setSessionLink: mocks.setLink, setWorkspaceThread: mocks.thread, setThreadMessages: mocks.messages, getActiveThreadSnapshot: () => ({}), setActiveSessionId: mocks.active } }; });
vi.mock('./agentHostRuntime', () => ({ ensureAgentHostStarted: mocks.start, getAgentHostClient: () => ({ actNative: mocks.action, resumeSession: mocks.resume }) }));
vi.mock('./chatPersistence', () => ({ flushSessionIndexPersistence: mocks.flush, persistSessionThreadSnapshot: mocks.persist }));
vi.mock('../git/versionControlRefresh', () => ({ notifyVersionControlMutation: mocks.refresh }));
import { performNativeAction } from './nativeExtensions';
const native = { runtimeId: 'opencode', connectionProfileId: 'profile', nativeSessionId: 'parent', modelId: 'model', modeId: 'build', runtimeMetadata: { workspaceRootPath: '/workspace' } };
beforeEach(() => {
  mocks.root = '/workspace';
  for (const value of Object.values(mocks)) if (typeof value === 'function') value.mockReset();
  mocks.link.mockReturnValue(native); mocks.start.mockResolvedValue({}); mocks.flush.mockResolvedValue(undefined); mocks.persist.mockResolvedValue(undefined);
  mocks.resume.mockResolvedValue({ ...native, history: [] });
});
it('selection change during host startup sends no native mutation', async () => {
  mocks.start.mockImplementation(async () => { mocks.root = '/other'; });
  await expect(performNativeAction('/workspace', 'source', 'share')).rejects.toThrow('Selection changed');
  expect(mocks.action).not.toHaveBeenCalled();
});
it('fork attaches a fresh child and parent identity before resume; never sends any prompt', async () => {
  mocks.action.mockResolvedValue({ generation: 1, native: { ...native, nativeSessionId: 'child', runtimeMetadata: { ...native.runtimeMetadata, parentNativeSessionId: 'parent' } } });
  await performNativeAction('/workspace', 'source', 'fork');
  expect(mocks.setLink.mock.calls[0][1]).toMatchObject({ nativeSessionId: 'child', parentSessionId: 'source', modelId: 'model', connectionProfileId: 'profile' });
  expect(mocks.flush).toHaveBeenCalled(); expect(mocks.resume.mock.calls[0][0].native.nativeSessionId).toBe('child'); expect(mocks.messages.mock.calls[0][0]).toEqual([]); expect(mocks.active).toHaveBeenCalledTimes(1);
});
it('revert refreshes workspace watchers and ignores a history response after workspace change', async () => {
  mocks.action.mockResolvedValue({ generation: 1, reconcile: true });
  mocks.resume.mockImplementation(async () => { mocks.root = '/other'; return { ...native, history: [] }; });
  await expect(performNativeAction('/workspace', 'source', 'revert', 'message')).rejects.toThrow('Selection changed');
  expect(mocks.refresh).toHaveBeenCalledWith('/workspace', 'workspace-edit'); expect(mocks.messages).not.toHaveBeenCalled(); expect(mocks.active).not.toHaveBeenCalled();
});
