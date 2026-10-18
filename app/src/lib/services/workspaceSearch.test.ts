import { describe, expect, it } from 'vitest';
import { workspaceMatchesQuery, rankWorkspaceProjects } from './workspaceSearch';
describe('workspace catalog search', () => {
  it('matches names and path fragments case-insensitively without changing input order', () => {
    const projects = [{ name: 'Server', rootPath: '/team/backend' }, { name: 'Web', rootPath: '/team/client' }];
    expect(projects.filter(project => workspaceMatchesQuery(project, 'BACK'))).toEqual([projects[0]]);
    expect(workspaceMatchesQuery(projects[0], 'srv')).toBe(true);
    expect(projects.filter(project => workspaceMatchesQuery(project, 'missing'))).toEqual([]);
    expect(projects.filter(project => workspaceMatchesQuery(project, '  '))).toEqual(projects);
  });
  it('uses recency for empty queries and ties, while relevance wins over any timestamp', () => {
    const older = { name: 'App', rootPath: '/older', lastUsedAt: '2020-01-01' };
    const recent = { name: 'Application tooling', rootPath: '/recent', lastUsedAt: '2099-01-01' };
    expect(rankWorkspaceProjects([older, recent], '')).toEqual([recent, older]);
    expect(rankWorkspaceProjects([recent, older], 'app')[0]).toBe(older);
    expect(rankWorkspaceProjects([older, { ...recent, name: 'App' }], 'app')[0].rootPath).toBe('/recent');
  });
});
