import { flushWorkspaceChatPersistence } from "./chatPersistence";
import { emitTo, listen } from '@tauri-apps/api/event';
import { getAllWebviewWindows, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { workspaceTransferBusy } from './workspaceTransferState';
export { workspaceTransferBusy } from './workspaceTransferState';
import { appState } from '../state/appState';
import { chatStore, type WorkspaceSessionsState } from '../state/chatStore';
import type { ContextId, WorkspaceEntry } from '../domain/contracts';
import { createNewWindowWithTransfer } from './windowManager';
import { flushSessionPersistence } from './sessionManager';
import { transferOpenFileClaim, syncOpenFileRegistryForWindow } from './openFileRegistry';
import { flushWorkspaceDocuments } from './workspaceDocuments';
import { detachWorkspaceTurns, resumeWorkspaceTurn, workspaceTurnDescriptors, type WorkspaceTurnCheckpoint } from '../ai/chatSendPipeline';
import { prepareWorkspaceTurnObserver } from './workspaceTurnObserver';
import { markWorkspaceIncoming, markWorkspaceOutgoing, setWorkspaceWindowOwner, workspaceWindowOwner } from './workspaceWindowPlacement';
import { normalizePathSync } from './diskFingerprint';
import { requestChoice } from './choiceDialog';
const REQUEST = 'spec-ops/workspace-window/request';
const REPLY = 'spec-ops/workspace-window/reply';
type WindowInfo = { windowId: string; roots: string[] };
type Request = { id: string; source: string; action: 'info' | 'prepare' | 'commit' | 'cancel' | 'focus' | 'settle'; root?: string; turns?: WorkspaceTurnCheckpoint[]; workspace?: WorkspaceEntry; chat?: WorkspaceSessionsState | null };
type Reply = { id: string; windowId: string; uncertain?: boolean; error?: string; info?: WindowInfo };
class WindowReplyError extends Error {}
let moving = false;
async function rpc(target: string, payload: Omit<Request, 'id' | 'source'>): Promise<Reply> {
  const id = crypto.randomUUID(); const source = getCurrentWebviewWindow().label;
  let release: (() => void) | undefined; let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    let resolve!: (reply: Reply) => void;
    const response = new Promise<Reply>(done => { resolve = done; });
    release = await listen<Reply>(REPLY, event => { if (event.payload.id === id && event.payload.windowId === target) resolve(event.payload); });
    timeout = setTimeout(() => resolve({ id, windowId: target, error: 'Window did not respond.', uncertain: true }), 15_000);
    await emitTo(target, REQUEST, { ...payload, id, source });
    const reply = await response; if (reply.error) throw reply.uncertain ? new Error(reply.error) : new WindowReplyError(reply.error); return reply;
  } finally { release?.(); if (timeout) clearTimeout(timeout); }
}
export async function focusExistingWorkspaceWindow(root: string): Promise<boolean> {
  const current = getCurrentWebviewWindow().label;
  for (const window of await getAllWebviewWindows()) {
    if (window.label === current) continue;
    const reply = await rpc(window.label, { action: 'info' });
    if (reply.info?.roots.some(path => normalizePathSync(path) === normalizePathSync(root))) {
      await rpc(window.label, { action: 'focus', root }); return true;
    }
  }
  return false;
}
export async function moveWorkspaceToWindow(workspaceId: ContextId, newWindow: boolean, notify: (message: string) => void): Promise<void> {
  if (moving) return;
  const entry = appState.getSnapshot().contexts.workspaces.find(workspace => workspace.id === workspaceId);
  if (!entry) return;
  let target: string | null = null;
  const source = getCurrentWebviewWindow().label;
  let checkpoints: WorkspaceTurnCheckpoint[] = [];
  const rollbackObservers = new Map<string, Awaited<ReturnType<typeof prepareWorkspaceTurnObserver>>>();
  let committed = false;
  try {
    if (!newWindow) {
      const windows = (await getAllWebviewWindows()).filter(window => window.label !== source);
      const replies = await Promise.all(windows.map(window => rpc(window.label, { action: 'info' })));
      if (!replies.length) { notify('No other windows are open.'); return; }
      const choice = await requestChoice({ title: 'Move workspace to window', message: entry.rootPath,
        options: replies.map(reply => ({ value: reply.windowId, label: `${reply.info?.roots.map(root => root.split(/[\\/]/).pop()).join(', ') || 'Empty window'} (${reply.windowId})` })),
      });
      if (!choice) return; target = choice.value;
    }
    moving = true; workspaceTransferBusy.set(true);
    await flushWorkspaceDocuments(entry.rootPath);
    await flushSessionPersistence(appState.getSnapshot(), source);
    const root = normalizePathSync(entry.rootPath);
    await setWorkspaceWindowOwner(root, source, source);
    const sessionIds = entry.snapshot.session.editorLayout.panes.flatMap(pane => pane.tabs.filter(tab => tab.kind === 'session').map(tab => tab.sessionId));
    await chatStore.loadWorkspaceSessions(root, { preferCachedIndex: true, prioritySessionIds: sessionIds });
    chatStore.mergeSessionDrafts(root, sessionIds);
    const chat = chatStore.getWorkspaceSessionsState(root);
    const descriptors = workspaceTurnDescriptors(root);
    if (chat && Object.entries(chat.runtimeBySessionId).some(([id, runtime]) => runtime.nativeOperation || (runtime.isGenerating && !descriptors.some(turn => turn.activeSessionId === id)))) throw new Error('Wait for the session to finish preparing its native operation, then move the workspace.');
    if (newWindow) target = await createNewWindowWithTransfer(appState.getSnapshot(), null, { waitForReady: true });
    if (!target) throw new Error('Could not open the destination window.');
    for (const turn of descriptors) rollbackObservers.set(turn.turnId, await prepareWorkspaceTurnObserver(turn));
    await rpc(target, { action: 'prepare', root, turns: descriptors });
    if (workspaceTurnDescriptors(root).some(turn => !descriptors.some(prepared => prepared.turnId === turn.turnId))) throw new Error("Session activity changed while preparing the move. Try again.");
    checkpoints = detachWorkspaceTurns(root);
    // Detaching and cloning are synchronous so no event or editor change can slip between them.
    const workspace = structuredClone(appState.getSnapshot().contexts.workspaces.find(workspace => workspace.id === workspaceId)!);
    const chatSnapshot = structuredClone(chatStore.getWorkspaceSessionsState(root));
    await flushWorkspaceChatPersistence(root, chatSnapshot);
    try { await rpc(target, { action: 'commit', root, workspace, chat: chatSnapshot, turns: checkpoints }); committed = true; }
    catch (error) {
      // A timeout is not a rejected transaction: the destination may still be writing.
      let failure = error;
      while (!committed) {
        try {
          committed = await workspaceWindowOwner(root) === target;
          if (committed) break;
          if (failure instanceof WindowReplyError) throw failure;
          const live = await getAllWebviewWindows();
          if (!live.some(window => window.label === target)) throw new WindowReplyError('Destination window closed before committing the move.');
          await rpc(target, { action: 'settle', root });
          committed = await workspaceWindowOwner(root) === target;
        } catch (caught) {
          if (caught instanceof WindowReplyError) throw caught;
          failure = caught;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }
    markWorkspaceOutgoing(root, true);
    appState.closeWorkspace(workspaceId);
    chatStore.evictWorkspace(root);
    await syncOpenFileRegistryForWindow(source, appState.getSnapshot());
    await flushSessionPersistence(appState.getSnapshot(), source);
    notify('Workspace moved.');
  } catch (error) {
    if (!committed) {
      if (target) {
        await rpc(target, { action: 'cancel' }).catch(() => {});
        for (const doc of entry.snapshot.documents) if (doc.filePath) await transferOpenFileClaim(doc.filePath, target, source, doc.id).catch(() => {});
      }
      for (const turn of checkpoints) resumeWorkspaceTurn(turn, rollbackObservers.get(turn.turnId)!.events(turn));
    }
    notify(String(error));
  } finally {
    rollbackObservers.forEach((observer, id) => { if (committed || !checkpoints.some(turn => turn.turnId === id)) observer.dispose(); });
    moving = false; workspaceTransferBusy.set(false);
  }
}
export async function listenWorkspaceWindowTransfers(): Promise<() => void> {
  const windowId = getCurrentWebviewWindow().label;
  const prepared = new Map<string, { root: string; observers: Map<string, Awaited<ReturnType<typeof prepareWorkspaceTurnObserver>>>; timer: ReturnType<typeof setTimeout>; completion?: Promise<void> }>();
  const committed = new Set<string>();
  const outcomes = new Map<string, { root: string; error?: string }>();
  const release = await listen<Request>(REQUEST, async event => {
    const request = event.payload; let info: WindowInfo | undefined; let error: string | undefined; let finishCommit: (() => void) | undefined;
    try {
      if (request.action === 'info') info = { windowId, roots: appState.getSnapshot().contexts.workspaces.map(workspace => workspace.rootPath) };
      if (request.action === 'focus') {
        const entry = appState.getSnapshot().contexts.workspaces.find(workspace => normalizePathSync(workspace.rootPath) === request.root || normalizePathSync(workspace.rootPath) === normalizePathSync(request.root!));
        if (entry) appState.switchContext(entry.id);
        await getCurrentWebviewWindow().setFocus();
      }
      if (request.action === 'prepare') {
        outcomes.delete(request.source);
        if (prepared.size || moving) throw new Error('Another workspace move is in progress.');
        if (appState.getSnapshot().contexts.workspaces.some(workspace => normalizePathSync(workspace.rootPath) === request.root)) throw new Error('Workspace is already in this window.');
        const observers = new Map<string, Awaited<ReturnType<typeof prepareWorkspaceTurnObserver>>>();
        try { for (const turn of request.turns ?? []) observers.set(turn.turnId, await prepareWorkspaceTurnObserver(turn)); }
        catch (error) { observers.forEach(observer => observer.dispose()); throw error; }
        const timer = setTimeout(() => { observers.forEach(observer => observer.dispose()); prepared.delete(request.source); workspaceTransferBusy.set(false); }, 45_000);
        prepared.set(request.source, { root: request.root!, observers, timer }); workspaceTransferBusy.set(true);
      }
      if (request.action === 'settle') {
        const pending = prepared.get(request.source);
        if (pending?.completion) await pending.completion;
        const outcome = outcomes.get(request.source);
        if (!outcome || outcome.root !== request.root) throw new Error('Move was not committed.');
        if (outcome.error) throw new Error(outcome.error);
      }
      if (request.action === 'cancel') {
        const pending = prepared.get(request.source);
        if (pending?.completion) throw new Error("Move is still committing.");
        if (pending) { clearTimeout(pending.timer); pending.observers.forEach(observer => observer.dispose()); prepared.delete(request.source); workspaceTransferBusy.set(false); }
      }
      if (request.action === 'commit' && !committed.has(request.id)) {
        const pending = prepared.get(request.source);
        if (!pending || pending.root !== request.root || !request.workspace) throw new Error('Workspace move was not prepared.');
        if (request.turns?.some(turn => !pending.observers.has(turn.turnId))) throw new Error("A native turn was not prepared for transfer.");
        clearTimeout(pending.timer);
        pending.completion = new Promise(resolve => { finishCommit = resolve; });
        const previousContext = appState.getSnapshot().contexts.activeContextId;
        const previousChatScope = chatStore.getActiveWorkspaceRoot();
        markWorkspaceIncoming(request.root!);
        if (request.chat) chatStore.adoptWorkspaceState(request.root!, request.chat);
        chatStore.setActiveWorkspaceRoot(request.root!);
        const id = appState.adoptWorkspace(request.workspace, windowId);
        const adopted = appState.getSnapshot().contexts.workspaces.find(workspace => workspace.id === id)!;
        try {
          for (const doc of adopted.snapshot.documents) if (doc.filePath) {
            const owner = await transferOpenFileClaim(doc.filePath, request.source, windowId, doc.id);
            if (owner) throw new Error('An open file belongs to another window.');
          }
          await flushSessionPersistence(appState.getSnapshot(), windowId);
          await setWorkspaceWindowOwner(request.root!, windowId, request.source);
        } catch (error) {
          appState.closeWorkspace(id);
          appState.switchContext(previousContext);
          chatStore.evictWorkspace(request.root!);
          chatStore.setActiveWorkspaceRoot(previousChatScope);
          clearTimeout(pending.timer); pending.observers.forEach(observer => observer.dispose()); prepared.delete(request.source); workspaceTransferBusy.set(false);
          for (const doc of request.workspace.snapshot.documents) if (doc.filePath) await transferOpenFileClaim(doc.filePath, windowId, request.source, doc.id).catch(() => {});
          await flushSessionPersistence(appState.getSnapshot(), windowId);
          throw error;
        }
        clearTimeout(pending.timer);
        committed.add(request.id);
        chatStore.setActiveWorkspaceRoot(request.root!);
        (request.turns ?? []).forEach(turn => resumeWorkspaceTurn(turn, pending.observers.get(turn.turnId)!.events(turn)));
        pending.observers.forEach((observer, id) => { if (!request.turns?.some(turn => turn.turnId === id)) observer.dispose(); });
        prepared.delete(request.source); workspaceTransferBusy.set(false);
        await getCurrentWebviewWindow().setFocus().catch(() => {});
      }
    } catch (caught) { error = String(caught); }
    if (finishCommit) { outcomes.set(request.source, { root: request.root!, error }); finishCommit(); }
    await emitTo(request.source, REPLY, { id: request.id, windowId, info, error });
  });
  return () => { release(); for (const pending of prepared.values()) { clearTimeout(pending.timer); pending.observers.forEach(observer => observer.dispose()); } };
}
