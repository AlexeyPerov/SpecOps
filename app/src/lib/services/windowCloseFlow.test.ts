import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmWindowClose } from './windowCloseFlow';
import { checkpointWorkspaceContexts } from './workspaceSavedContext';
import { appState } from '../state/appState';
vi.mock('./workspaceSavedContext', () => ({ checkpointWorkspaceContexts:vi.fn().mockResolvedValue(undefined) }));
vi.mock('./workspaceDocuments', () => ({ flushWorkspaceDocuments:vi.fn().mockResolvedValue(undefined) }));
vi.mock('./logging', () => ({ logDiagnostic:vi.fn().mockResolvedValue(undefined) }));
vi.mock('./confirmDialogUi', () => ({ requestConfirm:vi.fn().mockResolvedValue(false) }));
import { requestConfirm } from './confirmDialogUi';
beforeEach(()=>{appState.resetAppState();vi.mocked(checkpointWorkspaceContexts).mockReset().mockResolvedValue(undefined);});
describe('window close durability',()=>{
  it('aborts close on failed session flush',async()=>{
    const notify=vi.fn();expect(await confirmWindowClose({getWindowId:()=> 'secondary',notify,flushSession:async()=>{throw new Error('disk full');}})).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    expect(checkpointWorkspaceContexts).not.toHaveBeenCalled();
  });
  it('asks before closing when the project recovery checkpoint fails',async()=>{
    vi.mocked(checkpointWorkspaceContexts).mockRejectedValueOnce(new Error('recovery failed'));
    vi.mocked(requestConfirm).mockResolvedValueOnce(false);
    expect(await confirmWindowClose({getWindowId:()=> 'secondary',notify:vi.fn(),flushSession:async()=>{}})).toBe(false);
    expect(requestConfirm).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining('recovery failed')}));
    vi.mocked(checkpointWorkspaceContexts).mockRejectedValueOnce(new Error('damaged catalog'));
    vi.mocked(requestConfirm).mockResolvedValueOnce(true);
    expect(await confirmWindowClose({getWindowId:()=> 'secondary',notify:vi.fn(),flushSession:async()=>{}})).toBe(true);
  });
  it('repeats the flush when contexts change during it instead of failing',async()=>{
    let calls=0;const flushSession=async()=>{ if(++calls===1) appState.addWorkspace('/changed-during-close'); };
    expect(await confirmWindowClose({getWindowId:()=> 'secondary',notify:vi.fn(),flushSession})).toBe(true);
    expect(calls).toBe(2);
  });
  it('awaits project checkpoint before permitting secondary window removal',async()=>{
    let finish!:()=>void;vi.mocked(checkpointWorkspaceContexts).mockImplementationOnce(()=>new Promise<void>(done=>{finish=done;}));
    let settled=false;const pending=confirmWindowClose({getWindowId:()=> 'secondary',notify:vi.fn(),flushSession:async()=>{}}).then(result=>{settled=true;return result;});
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));expect(settled).toBe(false);finish();expect(await pending).toBe(true);
  });
});
