import { get } from "svelte/store";
import { notifyVersionControlMutation } from "../git/versionControlRefresh";
import { chatStore, chatIsGenerating } from '../state/chatStore';
import { ensureAgentHostStarted, getAgentHostClient } from './agentHostRuntime';
import { flushSessionIndexPersistence, persistSessionThreadSnapshot } from './chatPersistence';
import { reconcileNativeHistory } from '../session/history';
import { asNativeSessionId, isAgentRuntimeId } from '../session';
import type { NativeSessionRef } from '../session/adapter';
import type { NativeAction } from '../session/adapter/nativeExtensions';
export function extensionSession(root: string, sessionId: string): NativeSessionRef {
  const link = chatStore.getSessionLink(sessionId, root);
  if (!link?.nativeSessionId || !isAgentRuntimeId(link.runtimeId)) throw new Error('Select a bound native session.');
  return { runtimeId: link.runtimeId, nativeSessionId: asNativeSessionId(link.nativeSessionId), connectionProfileId: link.connectionProfileId, modelId: link.modelId, modeId: link.modeId, runtimeMetadata: link.runtimeMetadata };
}
const pending = new Set<string>();
export async function performNativeAction(root: string, sessionId: string, action: NativeAction, target?: string) {
  const key = `${root}\0${sessionId}`;
  if (pending.has(key)) throw new Error('Native action is still pending.');
  pending.add(key);
  try {
    const native = extensionSession(root, sessionId);
    const stillSelected = () => {
      if (chatStore.getActiveChatScopeKey() !== root || JSON.stringify(extensionSession(root, sessionId)) !== JSON.stringify(native) || get(chatIsGenerating)) throw new Error('Selection changed or a turn is active. Inspect native state before another action.');
    };
    stillSelected();
    await ensureAgentHostStarted();
    stillSelected();
    const result = await getAgentHostClient().actNative({ native, workspaceRootPath: root, action, target });
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
    if (result.native || result.reconcile) {
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
  } finally { pending.delete(key); }
}
