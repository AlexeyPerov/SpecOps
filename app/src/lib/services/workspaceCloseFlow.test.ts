import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";
import { registerConfirmRunner } from "./confirmDialogUi";
import { closeWorkspaceWithConfirm, saveAllDirtyDocumentsToDisk } from "./workspaceCloseFlow";
import { saveFile, saveFileAs } from "./fileSystem";
import { renameOpenFileRegistry } from "./openFileRegistry";

vi.mock('@tauri-apps/api/core', () => ({invoke:vi.fn().mockResolvedValue(false)}));
vi.mock('./workspaceWindowPlacement', async original => ({...await original<typeof import('./workspaceWindowPlacement')>(),setWorkspaceWindowOwner:vi.fn().mockResolvedValue(undefined)}));
import { setWorkspaceWindowOwner } from './workspaceWindowPlacement';
afterEach(()=>{delete (window as unknown as Record<string,unknown>).__TAURI_INTERNALS__;});
vi.mock("./fileSystem", () => ({
  saveFile: vi.fn(),
  saveFileAs: vi.fn(),
}));

vi.mock("./openFileRegistry", () => ({
  renameOpenFileRegistry: vi.fn().mockResolvedValue(undefined),
  syncOpenFileRegistryForWindow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./untitledSavePath", () => ({
  untitledSaveDefaultPath: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./workspaceCatalog', async original => ({ ...await original<typeof import('./workspaceCatalog')>(), saveCatalogProjectContext: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./sessionManager', () => ({ flushSessionPersistence: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./chatPersistence', () => ({ flushWorkspaceChatPersistence: vi.fn().mockResolvedValue(undefined) }));
import { saveCatalogProjectContext } from './workspaceCatalog';
import { flushSessionPersistence } from './sessionManager';
import { chatStore } from '../state/chatStore';

const saveFileMock = vi.mocked(saveFile);
const saveFileAsMock = vi.mocked(saveFileAs);
const renameMock = vi.mocked(renameOpenFileRegistry);

function setConfirmResult(result: boolean): void {
  registerConfirmRunner(() => Promise.resolve(result));
}

describe("closeWorkspaceWithConfirm — Save all writes to disk", () => {
  beforeEach(() => {
    appState.resetAppState();
    vi.mocked(setWorkspaceWindowOwner).mockReset().mockResolvedValue(undefined);
    vi.mocked(saveCatalogProjectContext).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(flushSessionPersistence).mockReset().mockResolvedValue(undefined);
    saveFileMock.mockReset();
    saveFileAsMock.mockReset();
    renameMock.mockReset();
    registerConfirmRunner(null);
  });

  it("persists dirty saved files to disk before closing", async () => {
    const wsId = appState.addWorkspace("/tmp/ws")!;
    appState.openFileInTab("/tmp/ws/a.txt", "old");
    const documentId = appState.findDocumentIdByPath("/tmp/ws/a.txt")!;
    appState.setDocumentContent(documentId, "edited");
    expect(
      appState.getActiveDocuments().find((doc) => doc.id === documentId)?.isDirty,
    ).toBe(true);

    saveFileMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: 6 });
    setConfirmResult(true); // choose "Save all"

    const closed = await closeWorkspaceWithConfirm(wsId, vi.fn(), {
      getWindowId: () => "win-a",
    });

    expect(closed).toBe(true);
    // Disk write happened with the buffer content (not just markDocumentSaved).
    expect(saveFileMock).toHaveBeenCalledWith({
      path: "/tmp/ws/a.txt",
      content: "edited",
      lineEnding: "lf",
      hasBom: false,
    });
    expect(renameMock).toHaveBeenCalledWith("/tmp/ws/a.txt", "/tmp/ws/a.txt", "win-a", documentId);
    // Workspace removed.
    expect(
      appState.getSnapshot().contexts.workspaces.some((ws) => ws.id === wsId),
    ).toBe(false);
  });

  it("aborts close when an untitled save-as is dismissed", async () => {
    const wsId = appState.addWorkspace("/tmp/ws")!;
    appState.createTab(); // untitled doc in the active workspace
    const document = appState.getActiveDocuments().find((doc) => doc.filePath === null);
    if (!document) {
      throw new Error("expected an untitled document");
    }
    appState.setDocumentContent(document.id, "unsaved text");

    saveFileAsMock.mockResolvedValue(null); // user cancels save-as
    setConfirmResult(true); // choose "Save all"

    const closed = await closeWorkspaceWithConfirm(wsId, vi.fn(), {
      getWindowId: () => "win-a",
    });

    expect(closed).toBe(false);
    expect(saveFileAsMock).toHaveBeenCalledOnce();
    // Workspace still present (close aborted).
    expect(
      appState.getSnapshot().contexts.workspaces.some((ws) => ws.id === wsId),
    ).toBe(true);
  });

  it("saves an untitled file via save-as and closes", async () => {
    const wsId = appState.addWorkspace("/tmp/ws")!;
    appState.createTab();
    const document = appState.getActiveDocuments().find((doc) => doc.filePath === null);
    if (!document) {
      throw new Error("expected an untitled document");
    }
    appState.setDocumentContent(document.id, "new content");

    saveFileAsMock.mockResolvedValue({
      path: "/tmp/ws/saved.txt",
      fingerprint: { mtimeMs: 5, sizeBytes: 10 },
    });
    setConfirmResult(true);

    const closed = await closeWorkspaceWithConfirm(wsId, vi.fn(), {
      getWindowId: () => "win-a",
    });

    expect(closed).toBe(true);
    expect(saveFileAsMock).toHaveBeenCalledWith("new content", undefined, {
      lineEnding: "lf",
      hasBom: false,
    });
    expect(renameMock).toHaveBeenCalledWith(null, "/tmp/ws/saved.txt", "win-a", document.id);
  });

  it("discards and closes without writing when the user chooses discard", async () => {
    const wsId = appState.addWorkspace("/tmp/ws")!;
    appState.openFileInTab("/tmp/ws/a.txt", "old");
    const documentId = appState.findDocumentIdByPath("/tmp/ws/a.txt")!;
    appState.setDocumentContent(documentId, "dirty");

    // First confirm: "Save all?" -> No (More options). Second: "Discard?" -> Yes.
    const results = [false, true];
    let i = 0;
    registerConfirmRunner(() => Promise.resolve(results[i++] ?? false));

    const closed = await closeWorkspaceWithConfirm(wsId, vi.fn(), {
      getWindowId: () => "win-a",
    });

    expect(closed).toBe(true);
    expect(saveFileMock).not.toHaveBeenCalled();
    expect(
      appState.getSnapshot().contexts.workspaces.some((ws) => ws.id === wsId),
    ).toBe(false);
  });

  it("aborts close when the user cancels both save and discard", async () => {
    const wsId = appState.addWorkspace("/tmp/ws")!;
    appState.openFileInTab("/tmp/ws/a.txt", "old");
    const documentId = appState.findDocumentIdByPath("/tmp/ws/a.txt")!;
    appState.setDocumentContent(documentId, "dirty");

    const results = [false, false]; // No to save, No to discard.
    let i = 0;
    registerConfirmRunner(() => Promise.resolve(results[i++] ?? false));

    const closed = await closeWorkspaceWithConfirm(wsId, vi.fn(), {
      getWindowId: () => "win-a",
    });

    expect(closed).toBe(false);
    expect(saveFileMock).not.toHaveBeenCalled();
    expect(
      appState.getSnapshot().contexts.workspaces.some((ws) => ws.id === wsId),
    ).toBe(true);
  });

  it("persists even when the workspace is not the active context", async () => {
    const wsAId = appState.addWorkspace("/tmp/ws-a")!;
    const wsBId = appState.addWorkspace("/tmp/ws-b")!;
    // Active context is now ws-b; close ws-a while it is not active.
    appState.switchContext(wsAId);
    appState.openFileInTab("/tmp/ws-a/a.txt", "old");
    const documentId = appState.findDocumentIdByPath("/tmp/ws-a/a.txt")!;
    appState.setDocumentContent(documentId, "edited-a");
    appState.switchContext(wsBId);
    expect(appState.getSnapshot().contexts.activeContextId).toBe(wsBId);

    saveFileMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: 8 });
    setConfirmResult(true);

    const closed = await closeWorkspaceWithConfirm(wsAId, vi.fn(), {
      getWindowId: () => "win-a",
    });

    expect(closed).toBe(true);
    expect(saveFileMock).toHaveBeenCalledWith({
      path: "/tmp/ws-a/a.txt",
      content: "edited-a",
      lineEnding: "lf",
      hasBom: false,
    });
  });
  it('does not release buffers when the catalog checkpoint fails', async () => {
    const id = appState.addWorkspace('/tmp/catalog-fail')!;
    vi.mocked(saveCatalogProjectContext).mockRejectedValueOnce(new Error('disk full'));
    const notify = vi.fn();
    expect(await closeWorkspaceWithConfirm(id, notify)).toBe(false);
    expect(appState.getWorkspaceRoot(id)).toBe('/tmp/catalog-fail');
    expect(notify).toHaveBeenCalledWith('Error: disk full');
  });
  it('does not close when the session flush fails', async () => {
    const id = appState.addWorkspace('/tmp/flush-fail')!;
    vi.mocked(flushSessionPersistence).mockRejectedValueOnce(new Error('flush failed'));
    expect(await closeWorkspaceWithConfirm(id, vi.fn())).toBe(false);
    expect(appState.getWorkspaceRoot(id)).toBe('/tmp/flush-fail');
  });
  it('rejects a session that starts during the checkpoint without cancelling it', async () => {
    const id = appState.addWorkspace('/tmp/running')!;
    vi.mocked(saveCatalogProjectContext).mockImplementationOnce(async () => {
      chatStore.adoptWorkspaceState('/tmp/running', { activeSessionId: 'session-1', sessionIndex: [], threadsBySessionId: {},
        runtimeBySessionId: { 'session-1': { isGenerating: true, isWaitingForPermission: false, isWaitingForQuestion: false, activeTurnId: 'turn-1', lastError: null, lastFailedTurnId: null } } });
      return undefined as never;
    });
    expect(await closeWorkspaceWithConfirm(id, vi.fn())).toBe(false);
    expect(appState.getWorkspaceRoot(id)).toBe('/tmp/running');
    expect(chatStore.getWorkspaceSessionsState('/tmp/running')?.runtimeBySessionId['session-1'].isGenerating).toBe(true);
    chatStore.evictWorkspace('/tmp/running');
  });
  it('keeps concurrent edits made during save-as', async () => {
    const id = appState.addWorkspace('/tmp/edit-race')!;
    const doc = appState.getActiveDocuments()[0]; appState.setDocumentContent(doc.id, 'before');
    saveFileAsMock.mockImplementationOnce(async () => { appState.setDocumentContent(doc.id, 'after'); return { path: '/tmp/a.txt', fingerprint: {mtimeMs:1,sizeBytes:6} }; });
    setConfirmResult(true);
    expect(await closeWorkspaceWithConfirm(id, vi.fn())).toBe(false);
    expect(appState.getActiveDocuments()[0].content).toBe('after');
  });
  it('saves Notepad buffers through the shared Save all path', async () => {
    const doc = appState.getActiveDocuments()[0]; appState.setDocumentContent(doc.id, 'note');
    saveFileAsMock.mockResolvedValueOnce({ path: '/tmp/note.txt', fingerprint: {mtimeMs:1,sizeBytes:4} });
    expect(await saveAllDirtyDocumentsToDisk('notepad', appState.getActiveDocuments().filter(doc => doc.isDirty), vi.fn(), {getWindowId: () => 'main'})).toBe(true);
    expect(appState.getActiveDocuments()[0].filePath).toBe('/tmp/note.txt');
  });

  it('restores only the failed-close workspace while preserving concurrent edits and focus', async () => {
    const original=appState.addWorkspace('/tmp/rollback')!;const other=appState.addWorkspace('/tmp/other')!;
    appState.switchContext(original);
    Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{},configurable:true});
    let reject!: (error:Error)=>void;
    vi.mocked(setWorkspaceWindowOwner).mockImplementationOnce(()=>new Promise<void>((_resolve,fail)=>{reject=fail;}));
    const pending=closeWorkspaceWithConfirm(original,vi.fn(),{getWindowId:()=> 'main'});
    await vi.waitFor(()=>expect(reject).toBeTypeOf('function'));
    expect(appState.getWorkspaceRoot(original)).toBeNull();
    appState.switchContext(other);const doc=appState.getActiveDocuments()[0];appState.setDocumentContent(doc.id,'concurrent edit');
    const third=appState.addWorkspace('/tmp/third')!;
    reject(new Error('ownership release failed'));
    expect(await pending).toBe(false);
    expect(appState.getWorkspaceRoot(original)).toBe('/tmp/rollback');
    expect(appState.getSnapshot().contexts.workspaces.map(workspace=>workspace.id)).toEqual([original,other,third]);
    expect(appState.getSnapshot().contexts.activeContextId).toBe(third);
    expect(appState.getWorkspaceActivationHistory()).toEqual([third,other,original]);
    expect(appState.getSnapshot().contexts.workspaces.find(workspace=>workspace.id===other)?.snapshot.documents[0].content).toBe('concurrent edit');
  });

});
