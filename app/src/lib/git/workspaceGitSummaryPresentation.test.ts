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
  it('leaves no-result cells blank while retaining diagnostics in details',()=>{
    for (const status of ['unknown','loading','fresh','stale','notGit','error'] as const) {
      const result=present({...empty,status,refreshing:status==='loading',error:status==='error'?'read failed':null});
      expect(result.text).toBe('');
      expect(result.mark).toBe('');
      expect(result.detail).not.toBe('');
      if(status==='error') expect(result.detail).toContain('read failed');
    }
  });
  it('keeps detached branch/tracking/dirty through stale, refresh and failure and uses non-color markers',()=>{
    const fresh: WorkspaceGitSummarySnapshot={...empty,status:'fresh',checkedAt:123,summary:{branchName:'abc123',isDetached:true,isUnborn:false,isDirty:true,hasConflicts:false,aheadBehind:{ahead:1,behind:0}}};
    expect(present(fresh).text).toBe('detached @ abc123 · ↑1 · dirty');expect(present(fresh).mark).toBe('●');
    for (const status of ['fresh','stale','loading','error'] as const) {
      for (const refreshing of [false,true]) {
        const result=present({...fresh,status,refreshing});
        expect(result.text).toBe(present(fresh).text);
        expect(result.mark).toBe('●');
      }
    }
    for(const status of ['stale','error'] as const) {const result=present({...fresh,status,error:status==='error'?'timeout':null});expect(result.text).toContain('abc123');expect(result.detail).toContain('Last successful check');expect(result.detail).toContain('no fetch');}
    expect(present({...fresh,summary:{...fresh.summary!,hasConflicts:true}}).mark).toBe('⚠');
    expect(present({...fresh,summary:{...fresh.summary!,isDirty:false}}).mark).toBe('✓');
  });
});
