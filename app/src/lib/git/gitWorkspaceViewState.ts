import type { CommitSummary, HistoryFilterMode, WorkingTreeDiffSource } from './types';

export interface GitWorkspaceViewState {
  view?: { sidebarCollapsed: boolean; section: 'history' | 'branches' | 'tags' | 'stashes' | 'changes'; navigation: string; revision: string | null; action: string | null; selected: CommitSummary | null };
  navigation?: { filter: string; collapsed: string[]; focus: string };
  history?: { limit: number; scroll: number; compact: boolean; order: 'date' | 'topological'; includeRemotes: boolean; widths: number[]; filter: HistoryFilterMode; jump: string | null };
  inspector?: { sha: string | null; path: string | null; metadataCollapsed: boolean };
  changes?: { draft: string; path: string | null; source: WorkingTreeDiffSource | null };
}
// Runtime-only view preferences; Git data is always reread after a remount.
const entries = new Map<string, GitWorkspaceViewState>();
const committedDraftListeners = new Set<(key: string, draft: string) => void>();
const MAX_VIEWS = 128;
export function readGitWorkspaceViewState(key: string | undefined): GitWorkspaceViewState | undefined { return key ? entries.get(key) : undefined; }
export function saveGitWorkspaceViewState(key: string | undefined, value: Partial<GitWorkspaceViewState>): void {
  if (!key) return;
  entries.set(key, { ...entries.get(key), ...value });
  if (entries.size > MAX_VIEWS) entries.delete(entries.keys().next().value!);
}
export function clearCommittedGitDraft(key: string | undefined, draft: string): void {
  if (!key) return;
  const entry = entries.get(key);
  if (entry?.changes?.draft === draft) entry.changes.draft = '';
  for (const listener of committedDraftListeners) listener(key, draft);
}
export function subscribeCommittedGitDraft(listener: (key: string, draft: string) => void): () => void {
  committedDraftListeners.add(listener);
  return () => { committedDraftListeners.delete(listener); };
}
export function clearGitWorkspaceViewStateForTests(): void { entries.clear(); }
