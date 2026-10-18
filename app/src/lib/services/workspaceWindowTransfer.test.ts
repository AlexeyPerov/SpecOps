import * as documentView from './appShellDocumentView';
import { beforeEach, describe, it, expect, vi } from 'vitest';
const bus = vi.hoisted(() => ({ windowId: 'main', listeners: new Map<string, (event: { payload: any }) => any>(), remote: undefined as ((target: string, event: string, payload: any) => Promise<void>) | undefined, owner: undefined as string | undefined }));
const hooks = vi.hoisted(() => ({ flush: vi.fn(async () => {}), placement: vi.fn(async (_root: string, owner: string) => { bus.owner = owner; }), claim: vi.fn(async () => null), resume: vi.fn(), dispose: vi.fn(), detach: vi.fn(() => [] as any[]), descriptors: vi.fn(() => [] as any[]) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, handler: (event: { payload: any }) => any) => { bus.listeners.set(event, handler); return () => bus.listeners.delete(event); },
  emitTo: async (target: string, event: string, payload: any) => { if (bus.remote) await bus.remote(target, event, payload); },
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: () => ({ label: bus.windowId, setFocus: async () => {} }), getAllWebviewWindows: async () => [{ label: 'main' }, { label: 'target' }] }));
vi.mock('./windowManager', () => ({ createNewWindowWithTransfer: async () => 'target' }));
vi.mock('./sessionManager', () => ({ flushSessionPersistence: hooks.flush, notifyTabsChangedForSession: () => {} }));
vi.mock('./workspaceDocuments', () => ({ flushWorkspaceDocuments: async () => {} }));
vi.mock('./chatPersistence', async () => ({ ...await vi.importActual('./chatPersistence'), flushWorkspaceChatPersistence: async () => {} }));
vi.mock('./openFileRegistry', () => ({ transferOpenFileClaim: hooks.claim, syncOpenFileRegistryForWindow: async () => {} }));
vi.mock('../ai/chatSendPipeline', () => ({ workspaceTurnDescriptors: hooks.descriptors, detachWorkspaceTurns: hooks.detach, resumeWorkspaceTurn: hooks.resume }));
vi.mock('./workspaceTurnObserver', () => ({ prepareWorkspaceTurnObserver: async () => ({ dispose: hooks.dispose, events: () => ({ async *[Symbol.asyncIterator]() {} }) }) }));
vi.mock('./workspaceWindowPlacement', () => ({ markWorkspaceOutgoing: () => {}, markWorkspaceIncoming: () => {}, workspaceWindowOwner: async () => bus.owner, setWorkspaceWindowOwner: hooks.placement }));
import { appState } from '../state/appState';
import { chatStore } from '../state/chatStore';
import { moveWorkspaceToWindow, listenWorkspaceWindowTransfers } from './workspaceWindowTransfer';
const REQUEST = 'spec-ops/workspace-window/request';
const REPLY = 'spec-ops/workspace-window/reply';
beforeEach(() => {
  bus.windowId = 'main'; bus.listeners.clear(); bus.remote = undefined; bus.owner = undefined;
  vi.clearAllMocks(); hooks.flush.mockResolvedValue(); hooks.claim.mockResolvedValue(null); hooks.descriptors.mockReturnValue([]); hooks.detach.mockReturnValue([]);
  appState.resetAppState(); chatStore.reset();
  vi.spyOn(chatStore, 'loadWorkspaceSessions').mockResolvedValue(undefined as never);
});
describe('workspace window transactions', () => {
  it('keeps the source workspace and dirty buffer until destination commit is acknowledged', async () => {
    const id = appState.addWorkspace('/source')!;
    const source = appState.getSnapshot().contexts.workspaces[0];
    const invalidate = vi.spyOn(documentView,'invalidateDocumentMarkdownHtml');
    source.snapshot.documents[0].content = 'unsaved'; source.snapshot.documents[0].isDirty = true;
    let moved: any;
    bus.remote = async (_target, event, request) => {
      if (event !== REQUEST) return;
      if (request.action === 'commit') {
        expect(appState.getWorkspaceRoot(id)).toBe('/source');
        moved = request.workspace; bus.owner = 'target';
      }
      bus.listeners.get(REPLY)!({ payload: { id: request.id, windowId: 'target' } });
    };
    const notify = vi.fn();
    await moveWorkspaceToWindow(id, true, notify);
    expect(moved.snapshot.documents[0].content).toBe('unsaved');
    expect(invalidate).toHaveBeenCalledWith(source.snapshot.documents[0].id);
    expect(appState.getWorkspaceRoot(id)).toBeNull();
    expect(notify).toHaveBeenCalledWith('Workspace moved.');
  });
  it('resumes detached work locally when destination commit fails', async () => {
    const id = appState.addWorkspace('/source')!;
    const turn = { root: '/source', activeSessionId: 'session-1', turnId: 'turn-1', pending: [] };
    hooks.descriptors.mockReturnValue([turn]); hooks.detach.mockReturnValue([turn]);
    bus.remote = async (_target, event, request) => {
      if (event !== REQUEST) return;
      bus.listeners.get(REPLY)!({ payload: { id: request.id, windowId: 'target', ...(request.action === 'commit' ? { error: 'Disk full' } : {}) } });
    };
    await moveWorkspaceToWindow(id, true, vi.fn());
    expect(appState.getWorkspaceRoot(id)).toBe('/source');
    expect(hooks.resume).toHaveBeenCalledWith(turn, expect.anything());
  });
  it('recognizes durable destination ownership when its reply reports a lost acknowledgment', async () => {
    const id = appState.addWorkspace('/source')!;
    bus.remote = async (_target, event, request) => {
      if (event !== REQUEST) return;
      if (request.action === 'commit') bus.owner = 'target';
      bus.listeners.get(REPLY)!({ payload: { id: request.id, windowId: 'target', ...(request.action === 'commit' ? { error: 'Reply failed' } : {}) } });
    };
    await moveWorkspaceToWindow(id, true, vi.fn());
    expect(appState.getWorkspaceRoot(id)).toBeNull();
  });
  it('settles a timed-out commit before removing or resuming the source', async () => {
    vi.useFakeTimers();
    try {
      const id = appState.addWorkspace('/source')!;
      let commitSent = false; let settleSent = false;
      bus.remote = async (_target, event, request) => {
        if (event !== REQUEST) return;
        if (request.action === 'commit') { commitSent = true; return; }
        if (request.action === 'settle') {
          expect(appState.getWorkspaceRoot(id)).toBe('/source');
          expect(hooks.resume).not.toHaveBeenCalled();
          settleSent = true; bus.owner = 'target';
        }
        bus.listeners.get(REPLY)!({ payload: { id: request.id, windowId: 'target' } });
      };
      const move = moveWorkspaceToWindow(id, true, vi.fn());
      await vi.waitFor(() => expect(commitSent).toBe(true));
      await vi.advanceTimersByTimeAsync(15_000);
      await move;
      expect(settleSent).toBe(true);
      expect(appState.getWorkspaceRoot(id)).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('rolls destination state and file claims back if its checkpoint cannot be persisted', async () => {
    const incomingId = appState.addWorkspace('/incoming')!;
    const workspace = structuredClone(appState.getSnapshot().contexts.workspaces[0]);
    workspace.snapshot.documents[0].filePath = '/incoming/file.md';
    appState.closeWorkspace(incomingId);
    const existingId = appState.addWorkspace('/existing')!;
    bus.windowId = 'target';
    const replies: any[] = []; bus.remote = async (_target, event, payload) => { if (event === REPLY) replies.push(payload); };
    const release = await listenWorkspaceWindowTransfers();
    const listener = bus.listeners.get(REQUEST)!;
    await listener({ payload: { id: 'prepare', source: 'main', action: 'prepare', root: '/incoming', turns: [] } });
    hooks.flush.mockRejectedValueOnce(new Error('Disk full'));
    await listener({ payload: { id: 'commit', source: 'main', action: 'commit', root: '/incoming', workspace, turns: [] } });
    expect(appState.getSnapshot().contexts.workspaces.map(entry => entry.rootPath)).toEqual(['/existing']);
    expect(appState.getSnapshot().contexts.activeContextId).toBe(existingId);
    expect(hooks.claim).toHaveBeenLastCalledWith('/incoming/file.md', 'target', 'main', workspace.snapshot.documents[0].id);
    expect(replies.at(-1).error).toContain('Disk full');
    expect(hooks.placement).not.toHaveBeenCalled();
    release();
  });
});
