import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../state/appState';
import { savedProjectContext, restoreSavedProjectContext, checkpointWorkspaceContexts } from './workspaceSavedContext';
import { getProjectCatalog, saveCatalogProjectContext } from './workspaceCatalog';
import { openPath } from './fileSystem';
import { invoke } from '@tauri-apps/api/core';
vi.mock('./workspaceCatalog', () => ({ getProjectCatalog: vi.fn(), projectIdentity: (root: string) => root,
  saveCatalogProjectContext: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./fileSystem', () => ({ openPath: vi.fn() }));
vi.mock('./diskFingerprint', async original => ({ ...await original<typeof import('./diskFingerprint')>(), statDiskFingerprint: vi.fn().mockResolvedValue({mtimeMs:1,sizeBytes:1}) }));
import { statDiskFingerprint } from './diskFingerprint';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
beforeEach(() => { appState.resetAppState(); vi.clearAllMocks(); vi.mocked(statDiskFingerprint).mockResolvedValue({mtimeMs:1,sizeBytes:1}); });
function context() {
  appState.addWorkspace('/project'); appState.openFileInTab('/project/a.txt', 'old file');
  appState.openOrFocusViewTab('workspace-notes');
  return appState.getWindowSessionSnapshot().workspaces[0].snapshot;
}
describe('closed project restore', () => {
  it('holds metadata only and rereads changed files, preserving mixed tabs and layout', async () => {
    const snapshot = context(); const saved = savedProjectContext(snapshot, 'close');
    expect(saved.snapshot.documents.every(doc => !('content' in doc) && !('savedContent' in doc))).toBe(true);
    expect(saved.snapshot.session.editorLayout).toEqual(snapshot.session.editorLayout);
    vi.mocked(getProjectCatalog).mockReturnValue({ savedContexts: { '/project': saved } } as never);
    vi.mocked(openPath).mockResolvedValue({ path:'/project/a.txt', content:'new disk', contentKind:'text', fingerprint:{mtimeMs:2,sizeBytes:8} } as never);
    const restored = await restoreSavedProjectContext('/project');
    expect(restored?.documents.find(doc => doc.filePath)?.content).toBe('new disk');
    expect(restored?.session.editorLayout).toEqual(snapshot.session.editorLayout);
  });
  it('explicit discard drops dirty file and untitled recovery', () => {
    const snapshot = context(); snapshot.documents = snapshot.documents.map(doc => ({ ...doc, content:'discarded', isDirty:true }));
    expect(savedProjectContext(snapshot, 'discard').recoveryBuffers).toBeUndefined();
  });
  it('window checkpoint keeps dirty file/untitled payload outside the catalog metadata', async () => {
    const snapshot = context(); snapshot.documents = snapshot.documents.map(doc => ({ ...doc, content:'recovery', isDirty:true }));
    const write = savedProjectContext(snapshot, 'window');
    expect(Object.values(write.recoveryBuffers!).every(buffer => buffer.content === 'recovery')).toBe(true);
    vi.mocked(getProjectCatalog).mockReturnValue({ savedContexts: { '/project': { ...write, recoveryRef:'pointer', recoveryBuffers:undefined } } } as never);
    vi.mocked(invoke).mockResolvedValue(write.recoveryBuffers);
    const restored = await restoreSavedProjectContext('/project');
    expect(restored?.documents.every(doc => doc.content === 'recovery' && doc.isDirty)).toBe(true);
    expect(openPath).not.toHaveBeenCalled();
  });
  it('preserves recovered dirty file buffers when the current disk file is very large', async () => {
    const snapshot = context();
    const file = snapshot.documents.find(doc => doc.filePath)!;
    file.content = 'unsaved recovered text'; file.isDirty = true;
    const saved = savedProjectContext(snapshot, 'window');
    vi.mocked(getProjectCatalog).mockReturnValue({ savedContexts: { '/project': { ...saved, recoveryRef:'pointer' } } } as never);
    vi.mocked(invoke).mockResolvedValue(saved.recoveryBuffers);
    vi.mocked(statDiskFingerprint).mockResolvedValue({mtimeMs:9,sizeBytes:100_000_000});
    const restored = await restoreSavedProjectContext('/project');
    expect(restored?.documents.find(doc => doc.filePath)).toMatchObject({content:'unsaved recovered text',savedContent:'old file',isDirty:true,contentKind:'text'});
    expect(openPath).not.toHaveBeenCalled();
  });
  it('clears stale missing metadata and adopts a recreated empty file BOM and line endings', async () => {
    const snapshot = context();
    const file = snapshot.documents.find(doc => doc.filePath)!; file.fileMissing = true; file.hasBom = false;
    const saved = savedProjectContext(snapshot, 'discard');
    vi.mocked(getProjectCatalog).mockReturnValue({ savedContexts: { '/project': saved } } as never);
    vi.mocked(openPath).mockResolvedValue({path:'/project/a.txt',content:'',contentKind:'text',lineEnding:'crlf',hasBom:true,fingerprint:{mtimeMs:2,sizeBytes:3}} as never);
    const restored = await restoreSavedProjectContext('/project');
    expect(restored?.documents.find(doc => doc.filePath)).toMatchObject({content:'',savedContent:'',fileMissing:false,hasBom:true,lineEnding:'crlf',diskFingerprint:{mtimeMs:2,sizeBytes:3}});
  });
  it('keeps missing file tabs and marks them unavailable', async () => {
    const saved = savedProjectContext(context(), 'discard');
    vi.mocked(getProjectCatalog).mockReturnValue({ savedContexts: { '/project': saved } } as never);
    vi.mocked(openPath).mockRejectedValue(new Error('No such file'));
    const restored = await restoreSavedProjectContext('/project');
    expect(restored?.documents.find(doc => doc.filePath)?.fileMissing).toBe(true);
  });
  it('checkpoints each open project before secondary window buffers can be removed', async () => {
    context(); appState.addWorkspace('/second');
    await checkpointWorkspaceContexts();
    expect(saveCatalogProjectContext).toHaveBeenCalledTimes(2);
  });
});
