import { describe, expect, it } from 'vitest';
import { workspaceGitSummaryPresentation as present } from './workspaceGitSummaryPresentation';
import type { WorkspaceGitSummarySnapshot } from './workspaceGitSummary';
const empty: WorkspaceGitSummarySnapshot = {status:'unknown',summary:null,checkedAt:null,error:null,refreshing:false};
describe('workspace Git summary presentation',()=>{
  it('reuses immutable presentations while new revisions update state and successful-check time',()=>{
    const first={...empty,status:'fresh' as const,checkedAt:123};
    const before=present(first);
    expect(present(first)).toBe(before);
    const after=present({...first,status:'stale',checkedAt:86_400_123});
    expect(after).not.toBe(before);
    expect(after.detail).toContain('Stale');
    expect(before.detail).toContain(new Date(first.checkedAt).toLocaleTimeString());
  });
  it('distinguishes every initial/no-result state in text and narrow marks',()=>{
    const unknown=present(empty),loading=present({...empty,status:'loading',refreshing:true}),notGit=present({...empty,status:'notGit'}),error=present({...empty,status:'error',error:'read failed'});
    expect(new Set([unknown.text,loading.text,notGit.text,error.text]).size).toBe(4);
    expect(new Set([unknown.mark,loading.mark,notGit.mark,error.mark]).size).toBe(4);
    expect(error.detail).toContain('read failed');
  });
  it('keeps detached branch/tracking/dirty through stale, refresh and failure and uses non-color markers',()=>{
    const fresh: WorkspaceGitSummarySnapshot={...empty,status:'fresh',checkedAt:123,summary:{branchName:'abc123',isDetached:true,isUnborn:false,isDirty:true,hasConflicts:false,aheadBehind:{ahead:1,behind:0}}};
    expect(present(fresh).text).toBe('detached @ abc123 · ↑1 · dirty');expect(present(fresh).mark).toBe('●');
    expect(present({...fresh,status:'stale'}).mark).toBe('◷');expect(present({...fresh,refreshing:true}).mark).toBe('↻');expect(present({...fresh,status:'error'}).mark).toBe('!');
    for(const status of ['stale','error'] as const) {const result=present({...fresh,status,error:status==='error'?'timeout':null});expect(result.text).toContain('abc123');expect(result.detail).toContain('Last successful check');expect(result.detail).toContain('no fetch');}
    expect(present({...fresh,summary:{...fresh.summary!,hasConflicts:true}}).mark).toBe('⚠');
    expect(present({...fresh,summary:{...fresh.summary!,isDirty:false}}).mark).toBe('✓');
  });
});
