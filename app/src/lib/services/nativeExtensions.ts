import { get } from "svelte/store";
import { notifyVersionControlMutation } from "../git/versionControlRefresh";
import { chatStore, chatIsGenerating } from '../state/chatStore';
import { ensureAgentHostStarted, getAgentHostClient } from './agentHostRuntime';
import { flushSessionIndexPersistence, persistSessionThreadSnapshot } from './chatPersistence';
import { reconcileNativeHistory } from '../session/history';
import { asNativeSessionId, isAgentRuntimeId } from '../session';
import type { NativeSessionRef } from '../session/adapter';
import type { NativeAction, NativeExtensionSnapshot } from '../session/adapter/nativeExtensions';
export function extensionSession(root: string, sessionId: string): NativeSessionRef {
  const link = chatStore.getSessionLink(sessionId, root);
  if (!link?.nativeSessionId || !isAgentRuntimeId(link.runtimeId)) throw new Error('Select a bound native session.');
  return { runtimeId: link.runtimeId, nativeSessionId: asNativeSessionId(link.nativeSessionId), connectionProfileId: link.connectionProfileId, modelId: link.modelId, modeId: link.modeId, runtimeMetadata: link.runtimeMetadata };
}
const pending = new Set<string>();
export async function performNativeAction(root: string, sessionId: string, action: NativeAction, target?: string, onProgress?: (snapshot: NativeExtensionSnapshot) => void) {
  const key = `${root}\0${sessionId}`;
  if (pending.has(key)) throw new Error('Native action is still pending.');
  pending.add(key);
  const operationId = `native-operation-${crypto.randomUUID()}`;
  try {
    const native = extensionSession(root, sessionId);
    const stillSelected = () => {
      if (chatStore.getActiveChatScopeKey() !== root || JSON.stringify(extensionSession(root, sessionId)) !== JSON.stringify(native) || get(chatIsGenerating)) throw new Error('Selection changed or a turn is active. Inspect native state before another action.');
    };
    stillSelected();
    await ensureAgentHostStarted();
    stillSelected();
    if (action === 'compact') chatStore.setNativeOperation(sessionId, { id: operationId, kind: 'compact' }, root);
    const result = await getAgentHostClient().actNative({ native, workspaceRootPath: root, action, target });
    if (!result.pending) stillSelected();
    if (result.pending) {
      const deadline = Date.now() + 310000;
      for (;;) {
        if (Date.now() >= deadline) throw new Error("Native compaction status timed out; inspect explicitly without replaying.");
        await new Promise(resolve => setTimeout(resolve, 250));
        const snapshot = await getAgentHostClient().inspectNative({ native, workspaceRootPath: root, view: 'checkpoints' });
        if (snapshot.generation !== result.generation || !result.operationId || !snapshot.operation || snapshot.operation.id !== result.operationId) throw new Error('Native compaction ownership changed; inspect explicitly without replaying.');
        onProgress?.(snapshot);
        if (snapshot.operation.status === 'running') continue;
        if (snapshot.operation.status !== 'completed') throw new Error('Native compaction stopped or failed; inspect native state without replaying.');
        result.historyChanged = true; break;
      }
    }
    stillSelected();
    if (result.reconcile) notifyVersionControlMutation(root, "workspace-edit");
    let destination = sessionId;
    let hydrate = native;
    if (result.native) {
      hydrate = result.native;
      if (hydrate.runtimeId !== native.runtimeId || hydrate.connectionProfileId !== native.connectionProfileId || hydrate.modelId !== native.modelId || hydrate.modeId !== native.modeId || hydrate.nativeSessionId === native.nativeSessionId) throw new Error('Native fork returned a different binding.');
      destination = `session-${crypto.randomUUID()}`;
      const at = new Date().toISOString();
      chatStore.setWorkspaceThread(root, { metadata: { sessionId: destination, threadId: `thread-${destination}`, createdAt: at, updatedAt: at }, messages: [] });
      chatStore.setSessionLink(destination, { runtimeId: hydrate.runtimeId, connectionProfileId: hydrate.connectionProfileId, nativeSessionId: hydrate.nativeSessionId, modelId: hydrate.modelId, modeId: hydrate.modeId, runtimeMetadata: hydrate.runtimeMetadata, parentSessionId: sessionId }, root);
      await flushSessionIndexPersistence(root);
      stillSelected();
    }
    if (result.native || result.reconcile || result.historyChanged) {
      const resumed = await getAgentHostClient().resumeSession({ native: hydrate, workspaceRootPath: root });
      stillSelected();
      if (resumed.history === undefined) throw new Error('Native history unavailable. Resume explicitly.');
      // Native checkpoint history is authoritative, including removal of reverted messages.
      chatStore.setThreadMessages(reconcileNativeHistory([], resumed.history, []), destination, root);
      const thread = chatStore.getActiveThreadSnapshot(destination);
      if (thread) await persistSessionThreadSnapshot(root, destination, thread);
      stillSelected();
      if (result.native) chatStore.setActiveSessionId(destination);
    }
    return result;
  } finally { if (action === 'compact') chatStore.setNativeOperation(sessionId, null, root, operationId); pending.delete(key); }
}

/** Persist one user intent before dispatch; the host keeps a durable no-replay receipt. */
export async function steerNativeTurn(root: string, sessionId: string, text: string) {
  const key = `${root}\0${sessionId}`;
  if (pending.has(key)) throw new Error('Native operation is pending.');
  pending.add(key);
  try {
    const native = extensionSession(root, sessionId);
    if (native.runtimeId !== 'codex' || !text.trim() || text.length > 65536) throw new Error('Native steering is unavailable for this selection.');
    const check = () => {
      if (chatStore.getActiveChatScopeKey() !== root || JSON.stringify(extensionSession(root, sessionId)) !== JSON.stringify(native) || !get(chatIsGenerating)) throw new Error('The selected active turn changed; no follow-up was sent.');
    };
    check(); await ensureAgentHostStarted(); check();
    const clientMessageId = `steer-${crypto.randomUUID()}`;
    if (!chatStore.appendMessage({ id: clientMessageId, role: 'user', content: text, createdAt: new Date().toISOString(), completionState: 'interrupted' }, { sessionId, skipCompaction: true })) throw new Error('Could not persist steering intent.');
    const intent = chatStore.getActiveThreadSnapshot(sessionId);
    if (!intent) throw new Error('Steering intent is unavailable.');
    await persistSessionThreadSnapshot(root, sessionId, intent); check();
    const result = await getAgentHostClient().actNative({ native, workspaceRootPath: root, action: 'steer', text, clientMessageId });
    if (chatStore.getActiveChatScopeKey() !== root || JSON.stringify(extensionSession(root, sessionId)) !== JSON.stringify(native)) throw new Error('Selection changed after native steering; explicitly resume to inspect history.');
    const current = chatStore.getActiveThreadSnapshot(sessionId);
    if (current) {
      chatStore.setThreadMessages(current.messages.map(message => message.id === clientMessageId ? { ...message, nativeTurnId: result.nativeTurnId, completionState: 'completed' as const } : message), sessionId, root);
      const updated = chatStore.getActiveThreadSnapshot(sessionId);
      if (updated) await persistSessionThreadSnapshot(root, sessionId, updated);
    }
  } catch { throw new Error('Steering was rejected or its outcome is uncertain. Resume native history explicitly; no follow-up or retry was sent.'); }
  finally { pending.delete(key); }
}

export async function stopNativeOperation(root: string, sessionId: string) {
  const runtime = chatStore.getRuntimeState(sessionId, root);
  const owner = runtime.nativeOperation?.id;
  if (!owner) return;
  await getAgentHostClient().cancelTurn({ native: extensionSession(root, sessionId) });
  chatStore.setNativeOperation(sessionId, null, root, owner);
}
