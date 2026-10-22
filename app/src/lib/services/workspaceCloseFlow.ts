import { setWorkspaceContextClosing } from './workspaceContextTransition';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isWorkspaceTransferBusy } from './workspaceTransferState';
import { workspaceTurnDescriptors } from '../ai/chatSendPipeline';
import { flushWorkspaceChatPersistence } from './chatPersistence';
import { flushSessionPersistence } from './sessionManager';
import { savedProjectContext } from './workspaceSavedContext';
import { saveCatalogProjectContext } from './workspaceCatalog';
import { releaseWorkspaceGitSummary } from '../git/workspaceGitSummary';
import { releaseWorkspaceDocuments, workspaceDocumentsSettled } from './workspaceDocuments';
import { invalidateDocumentMarkdownHtml } from './appShellDocumentView';
import { setWorkspaceWindowOwner } from "./workspaceWindowPlacement";
import { flushWorkspaceDocuments } from "./workspaceDocuments";
import type { ContextId, DocumentState } from "../domain/contracts";
import { DEFAULT_TAB_GROUP_ID } from "../domain/contracts";
import { appState } from "../state/appState";
import { chatStore } from "../state/chatStore";
import { requestConfirm } from "./confirmDialogUi";
import { saveFile, saveFileAs } from "./fileSystem";
import { untitledSaveDefaultPath } from "./untitledSavePath";
import { renameOpenFileRegistry, syncOpenFileRegistryForWindow } from "./openFileRegistry";
import { documentEncodeOptions } from "./documentSave";
import { normalizePathSync } from "./diskFingerprint";

/**
 * Shared workspace-close flow.
 *
 * Drives the save / discard / cancel decision via `requestConfirm` (async),
 * then persists (save-all) or discards before removing the workspace from the
 * store. Returns `true` when the workspace was closed, `false` when the user
 * cancelled (or when a write failed / a save-as was dismissed) or the workspace
 * was already gone.
 *
 * Persistence stays in this flow layer — `closeWorkspace` itself remains a pure
 * state transition. The dirty documents are written to disk via the same path
 * as the Save / Save All commands, and in-memory state is synced with the
 * context-aware disk-state API because the closing workspace may not be the
 * active context.
 */
const closing = new Set<ContextId>();
export function workspaceCloseBlockedReason(workspaceId: ContextId): string | null {
  if (isWorkspaceTransferBusy()) return 'Wait for the workspace move to finish before closing.';
  const root = appState.getWorkspaceRoot(workspaceId);
  if (!root) return 'Workspace is no longer open.';
  const chat = chatStore.getWorkspaceSessionsState(normalizePathSync(root));
  if (workspaceTurnDescriptors(normalizePathSync(root)).length || Object.values(chat?.runtimeBySessionId ?? {}).some(runtime => runtime.isGenerating || runtime.nativeOperation || runtime.isWaitingForPermission || runtime.isWaitingForQuestion)) {
    return 'This workspace has a running session or native operation. Wait for it to finish before closing.';
  }
  return null;
}
export async function closeWorkspaceWithConfirm(
  workspaceId: ContextId,
  notify: (message: string) => void,
  deps: { getWindowId: () => string } = { getWindowId: () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? getCurrentWebviewWindow().label : 'main' },
): Promise<boolean> {
  if (closing.has(workspaceId)) return false;
  closing.add(workspaceId);
  const closingRoot = appState.getWorkspaceRoot(workspaceId);
  if (closingRoot) setWorkspaceContextClosing(closingRoot, true);
  try {
    const blocked = workspaceCloseBlockedReason(workspaceId);
    if (blocked) { notify(blocked); return false; }
    const root = appState.getWorkspaceRoot(workspaceId)!;
    await assertNoNativeWorkspaceMutation(root);
    await flushWorkspaceDocuments(root);
    const dirtyDocuments = appState.getWorkspaceDirtyDocuments(workspaceId);
    let discard = false;
    if (dirtyDocuments.length) {
      const shouldSave = await requestConfirm({ title: 'Unsaved changes',
        message: `This workspace has ${dirtyDocuments.length} unsaved file(s). Save changes before closing?`,
        confirmLabel: 'Save all', cancelLabel: 'More options' });
      if (shouldSave) {
        if (!await saveAllDirtyDocumentsToDisk(workspaceId, dirtyDocuments, notify, deps)) return false;
      } else {
        discard = await requestConfirm({ title: 'Discard changes', message: 'Discard all unsaved changes and close this workspace?',
          confirmLabel: 'Discard & close', cancelLabel: 'Cancel', danger: true });
        if (!discard) return false;
        const current = appState.getWorkspaceDirtyDocuments(workspaceId);
        if (current.length !== dirtyDocuments.length || current.some(doc => !dirtyDocuments.some(before => before.id === doc.id && before.content === doc.content))) {
          throw new Error('Workspace changed while confirming. Review the changes and close again.');
        }
      }
    }
    return await finishClose(workspaceId, notify, deps.getWindowId(), discard);
  } catch (error) { notify(String(error)); return false; }
  finally { closing.delete(workspaceId); if (closingRoot) setWorkspaceContextClosing(closingRoot, false); }
}

/**
 * Persist every dirty workspace document to disk, mirroring the Save All
 * command's write path. Untitled documents (`filePath === null`) go through
 * save-as; if the user dismisses any save-as dialog the whole close is
 * aborted (returns `false`) so no buffer is silently lost. Each successful
 * write also records the post-write disk fingerprint so a subsequent watcher
 * self-echo is suppressed.
 */
export async function saveAllDirtyDocumentsToDisk(
  workspaceId: ContextId,
  dirtyDocuments: DocumentState[],
  notify: (message: string) => void,
  deps: { getWindowId: () => string },
): Promise<boolean> {
  let saved = 0;
  for (const doc of dirtyDocuments) {
    let targetPath = doc.filePath;
    const previousPath = doc.filePath;
    let fingerprint;
    const encodeOptions = documentEncodeOptions(doc);
    if (!targetPath) {
      const savedAs = await saveFileAs(
        doc.content,
        await untitledSaveDefaultPath(doc.content, appState.getWorkspaceRoot(workspaceId)),
        encodeOptions,
      );
      if (!savedAs) {
        // Cancelled save-as: abort the whole close so the user can decide what
        // to do instead of dropping the unsaved buffer on workspace removal.
        notify("Close cancelled: save was dismissed.");
        return false;
      }
      targetPath = savedAs.path;
      fingerprint = savedAs.fingerprint;
    } else {
      fingerprint = await saveFile({
        path: targetPath,
        content: doc.content,
        ...encodeOptions,
      });
    }
    const state = appState.getSnapshot();
    const context = [...state.contexts.tabGroups, ...state.contexts.workspaces].find(entry => entry.id === workspaceId)?.snapshot;
    const current = context?.documents.find(entry => entry.id === doc.id);
    if (!current || current.content !== doc.content) throw new Error('Document changed while saving. Review the changes and close again.');
    appState.markDocumentSavedForContext(workspaceId, doc.id, targetPath, doc.content);
    appState.setDocumentDiskStateForContext(workspaceId, doc.id, {
      diskFingerprint: fingerprint,
      fileMissing: false,
    });
    await renameOpenFileRegistry(previousPath, targetPath, deps.getWindowId(), doc.id);
    saved += 1;
  }
  if (saved > 0) {
    notify(`Saved ${saved} document(s).`);
  }
  return true;
}

async function finishClose(workspaceId: ContextId, notify: (message: string) => void, windowId: string, discard: boolean): Promise<boolean> {
  const entry = appState.getSnapshot().contexts.workspaces.find(workspace => workspace.id === workspaceId);
  if (!entry) return false;
  const root = normalizePathSync(entry.rootPath);
  const chat = chatStore.getWorkspaceSessionsState(root);
  const chatRevision = chatStore.getSnapshot().workspaces[root];
  const validate = async () => {
    await assertNoNativeWorkspaceMutation(entry.rootPath);
    if (!discard && appState.getWorkspaceDirtyDocuments(workspaceId).length) throw new Error('Workspace changed while saving. Review unsaved changes and close again.');
    if (!workspaceDocumentsSettled(root)) throw new Error('Workspace notes or tasks changed while closing. Try again.');
    const reason = workspaceCloseBlockedReason(workspaceId);
    if (reason) throw new Error(reason);
    if (appState.getSnapshot().contexts.workspaces.find(workspace => workspace.id === workspaceId)?.snapshot !== entry.snapshot || chatStore.getSnapshot().workspaces[root] !== chatRevision) {
      throw new Error('Workspace activity changed while closing. Try again.');
    }
  };
  const native = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  let committed = false;
  let removed = false;
  let successor: ContextId | null = null;
  const originalIndex = appState.getSnapshot().contexts.workspaces.findIndex(workspace => workspace.id === workspaceId);
  const wasActivated = appState.getWorkspaceActivationHistory().includes(workspaceId);
  const originallyActive = appState.getSnapshot().contexts.activeContextId === workspaceId;
  try {
    await validate();
    await flushWorkspaceChatPersistence(root, chat);
    await validate();
    await saveCatalogProjectContext(entry.rootPath, savedProjectContext(entry.snapshot, discard ? 'discard' : 'close'));
    await validate();
    // Persist the state after removal before dropping the only live buffers.
    const state = appState.getSnapshot();
    const workspaces = state.contexts.workspaces.filter(workspace => workspace.id !== workspaceId);
    await flushSessionPersistence({ ...state, contexts: { ...state.contexts, workspaces,
      activeContextId: state.contexts.activeContextId === workspaceId ? workspaces[0]?.id ?? DEFAULT_TAB_GROUP_ID : state.contexts.activeContextId } }, windowId);
    await validate();
    const blocked = workspaceCloseBlockedReason(workspaceId);
    if (blocked || (!discard && appState.getWorkspaceDirtyDocuments(workspaceId).length) || appState.getSnapshot().contexts.workspaces.find(workspace => workspace.id === workspaceId)?.snapshot !== entry.snapshot || chatStore.getSnapshot().workspaces[root] !== chatRevision || !workspaceDocumentsSettled(root)) throw new Error(blocked ?? 'Workspace changed while closing. Try again.');
    const closed = appState.closeWorkspace(workspaceId);
    removed = closed;
    successor = appState.getSnapshot().contexts.activeContextId;
    if (closed) {
      if (native) await setWorkspaceWindowOwner(entry.rootPath, null, windowId);
      committed = true;
      chatStore.evictWorkspace(root);
      releaseWorkspaceDocuments(root);
      releaseWorkspaceGitSummary(entry.rootPath);
      for (const doc of entry.snapshot.documents) invalidateDocumentMarkdownHtml(doc.id);
      await syncOpenFileRegistryForWindow(windowId, appState.getSnapshot()).catch(error => notify(`Workspace closed; open-file registry update failed: ${String(error)}`));
      notify('Workspace closed.');
    }
    return closed;
  } catch (error) {
    if (committed) { notify(`Workspace closed; resource cleanup failed: ${String(error)}`); return true; }
    if (removed) {
      const activate = originallyActive && appState.getSnapshot().contexts.activeContextId === successor;
      appState.restoreWorkspaceAfterFailedClose(entry, originalIndex, activate, wasActivated);
    }
    await flushSessionPersistence(appState.getSnapshot(), windowId).catch(() => {});
    throw error;
  }
}

async function assertNoNativeWorkspaceMutation(root: string): Promise<void> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && await invoke<boolean>('workspace_has_active_git_mutation', { root })) {
    throw new Error('This workspace has a running Git operation. Wait for it to finish before closing.');
  }
}
