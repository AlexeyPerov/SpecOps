import { beforeEach, describe, expect, it } from 'vitest';
import { clearGitWorkspaceViewStateForTests, readGitWorkspaceViewState, saveGitWorkspaceViewState } from './gitWorkspaceViewState';
beforeEach(() => clearGitWorkspaceViewStateForTests());
describe('Git workspace view state', () => {
  it('evicts the least recently saved view, not the first inserted one', () => {
    saveGitWorkspaceViewState('first', { navigation: { filter: 'kept', collapsed: [], focus: '' } });
    for (let index = 0; index < 127; index += 1) saveGitWorkspaceViewState(`view-${index}`, {});
    saveGitWorkspaceViewState('first', { inspector: { sha: null, path: null, metadataCollapsed: false } });
    saveGitWorkspaceViewState('overflow', {});
    expect(readGitWorkspaceViewState('first')?.navigation?.filter).toBe('kept');
    expect(readGitWorkspaceViewState('view-0')).toBeUndefined();
  });
});
