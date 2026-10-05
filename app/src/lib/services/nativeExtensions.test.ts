import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ root: '/workspace', start: vi.fn(), action: vi.fn(), resume: vi.fn(), link: vi.fn(), setLink: vi.fn(), thread: vi.fn(), messages: vi.fn(), flush: vi.fn(), persist: vi.fn(), active: vi.fn(), refresh: vi.fn(), inspect: vi.fn(), operation: vi.fn(), runtime: vi.fn(), cancel: vi.fn() }));
vi.mock('../state/chatStore', async () => { const { writable } = await import('svelte/store'); return { chatIsGenerating: writable(false), chatStore: { getActiveChatScopeKey: () => mocks.root, getSessionLink: mocks.link, setSessionLink: mocks.setLink, setWorkspaceThread: mocks.thread, setThreadMessages: mocks.messages, getActiveThreadSnapshot: () => ({}), setActiveSessionId: mocks.active, setNativeOperation: mocks.operation, getRuntimeState: mocks.runtime } }; });
vi.mock('./agentHostRuntime', () => ({ ensureAgentHostStarted: mocks.start, getAgentHostClient: () => ({ actNative: mocks.action, resumeSession: mocks.resume, inspectNative: mocks.inspect, cancelTurn: mocks.cancel }) }));
vi.mock('./chatPersistence', () => ({ flushSessionIndexPersistence: mocks.flush, persistSessionThreadSnapshot: mocks.persist }));
vi.mock('../git/versionControlRefresh', () => ({ notifyVersionControlMutation: mocks.refresh }));
import { performNativeAction, stopNativeOperation } from './nativeExtensions';
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

it.each(['missing', 'generation', 'failed', 'owner'] as const)('compact fails closed on %s ownership/status without history/file mutation or replay', async kind => {
  mocks.action.mockResolvedValue({ generation: 1, pending: true, operationId: 'owned' });
  mocks.inspect.mockResolvedValue({ generation: kind === 'generation' ? 2 : 1, actions: [], rows: [], scope: 'native', ...(kind === 'missing' ? {} : { operation: { id: kind === 'owner' ? 'other' : 'owned', status: kind === 'failed' ? 'failed' : 'completed', detail: 'native' } }) });
  await expect(performNativeAction('/workspace', 'source', 'compact')).rejects.toThrow();
  expect(mocks.action).toHaveBeenCalledTimes(1); expect(mocks.resume).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.operation.mock.calls[0][1]).toMatchObject({ kind: 'compact' });
  expect(mocks.operation.mock.calls.at(-1)).toEqual(['source', null, '/workspace', mocks.operation.mock.calls[0][1].id]);
});
it('compact reconciles conversation only after observed completion and preserves file watchers', async () => {
  mocks.action.mockResolvedValue({ generation: 1, pending: true, operationId: 'owned' });
  mocks.inspect.mockResolvedValueOnce({ generation: 1, actions: [], rows: [], scope: 'native', operation: { id: 'owned', status: 'running', detail: 'started' } }).mockResolvedValue({ generation: 1, actions: [], rows: [], scope: 'native', operation: { id: 'owned', status: 'completed', detail: 'completed' } });
  const progress = vi.fn(); await performNativeAction('/workspace', 'source', 'compact', undefined, progress);
  expect(progress).toHaveBeenCalledTimes(2); expect(mocks.resume).toHaveBeenCalledTimes(1); expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.action).toHaveBeenCalledTimes(1);
});

it('Stop keeps an owned activity when cancellation acknowledgment fails', async () => {
  mocks.runtime.mockReturnValue({ nativeOperation: { id: 'owned', kind: 'compact' } }); mocks.cancel.mockRejectedValue(new Error('Host lost'));
  await expect(stopNativeOperation('/workspace', 'source')).rejects.toThrow('Host lost'); expect(mocks.operation).not.toHaveBeenCalled();
});
it('Stop clears only the observed owner after successful native cancellation', async () => {
  mocks.runtime.mockReturnValue({ nativeOperation: { id: 'owned', kind: 'compact' } }); mocks.cancel.mockResolvedValue(undefined);
  await stopNativeOperation('/workspace', 'source'); expect(mocks.cancel).toHaveBeenCalledWith({ native }); expect(mocks.operation).toHaveBeenCalledWith('source', null, '/workspace', 'owned');
});
