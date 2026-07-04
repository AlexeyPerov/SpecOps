# FIX-07 — Git probe and status performance [DONE]

**Priority:** P2 · **Score:** 6 · **Agent:** medium · **Estimate:** ~0.75d

**Source:** Git integration code review (2026-07-04)  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

1. `loadWorkspaceGitColumnCellInternal` calls `checkGitAvailable()` **per workspace row** — redundant `git --version` probes.
2. `queryRepositoryStatusSummary` runs **3–4 sequential git commands** per repo (branch, dirty, optional ahead/behind).
3. Workspace Manager serializes all git globally, amplifying latency with many workspaces.

## Goal

Reduce redundant subprocess spawns for status summaries without changing displayed information.

## Required context

1. `app/src/lib/git/workspaceManagerGitColumn.ts`
2. `app/src/lib/git/repositoryStatusSummary.ts`
3. `app/src/lib/git/gitService.ts` — `queryCurrentBranch`, `isWorkingTreeDirty`, `queryAheadBehind`
4. `app/src/lib/git/versionControlProbe.ts` — `checkGitAvailable`

## Implementation steps

1. Add module-level cached `GitAvailableResponse` with TTL (e.g. 60s) or invalidate on first failure; share across column loads and VC probe.
2. Investigate combined status query options:
   - e.g. `git status -sb` for branch + dirty hint in one call where sufficient
   - or single scriptable invocation documented in tests
3. Parallelize independent calls within one summary where safe (branch + porcelain already partially parallel in `queryRepositoryStatusSummary`).
4. After FIX-06, ensure per-repo queue does not block unrelated repos during bulk column refresh.
5. Benchmark or log `durationMs` aggregate for N workspaces in diagnostics (dev-only optional).
6. Update tests; verify column text unchanged for fixture repos.

## Acceptance checklist

- [ ] Opening Workspace Manager with N git workspaces triggers at most one `git --version` probe per session/TTL.
- [ ] Status summary for one repo uses fewer subprocess calls than current 3–4 (document before/after count).
- [ ] Displayed branch/dirty/ahead-behind text matches prior behavior on fixture repos.
- [ ] FIX-06 per-repo queue still respected.

## Dependencies

- FIX-06 recommended (avoids global serialization amplifying latency)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
