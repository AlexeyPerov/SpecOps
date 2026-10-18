import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmWindowClose } from './windowCloseFlow';
import { checkpointWorkspaceContexts } from './workspaceSavedContext';
import { appState } from '../state/appState';
vi.mock('./workspaceSavedContext', () => ({ checkpointWorkspaceContexts:vi.fn().mockResolvedValue(undefined) }));
vi.mock('./workspaceDocuments', () => ({ flushWorkspaceDocuments:vi.fn().mockResolvedValue(undefined) }));
vi.mock('./logging', () => ({ logDiagnostic:vi.fn().mockResolvedValue(undefined) }));
beforeEach(()=>{appState.resetAppState();vi.mocked(checkpointWorkspaceContexts).mockReset().mockResolvedValue(undefined);});
describe('window close durability',()=>{
  it('aborts close on failed session flush',async()=>{
    const notify=vi.fn();expect(await confirmWindowClose({getWindowId:()=> 'secondary',notify,flushSession:async()=>{throw new Error('disk full');}})).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    expect(checkpointWorkspaceContexts).not.toHaveBeenCalled();
  });
  it('aborts close on failed project recovery checkpoint',async()=>{
    vi.mocked(checkpointWorkspaceContexts).mockRejectedValueOnce(new Error('recovery failed'));
    expect(await confirmWindowClose({getWindowId:()=> 'secondary',notify:vi.fn(),flushSession:async()=>{}})).toBe(false);
  });
  it('awaits project checkpoint before permitting secondary window removal',async()=>{
    let finish!:()=>void;vi.mocked(checkpointWorkspaceContexts).mockImplementationOnce(()=>new Promise<void>(done=>{finish=done;}));
    let settled=false;const pending=confirmWindowClose({getWindowId:()=> 'secondary',notify:vi.fn(),flushSession:async()=>{}}).then(result=>{settled=true;return result;});
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));expect(settled).toBe(false);finish();expect(await pending).toBe(true);
  });
});
