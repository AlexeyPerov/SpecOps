# FIX-02 — System git project-tree badges

**Priority:** P0 · **Score:** 8 · **Agent:** medium · **Estimate:** ~1d

**Source:** Git integration code review (2026-07-04)  
**Backlog:** [S-01](../../backlog.md) — Replace project-tree M/A/D badges with system git  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

Project-tree modified/added/deleted badges use OpenCode `file.status` via `fileStatusTracker.ts`, while the Version Control tab uses system `git status --porcelain`. The two sources can disagree, confusing users.

## Goal

Drive project-tree file badges from system git status for git-backed workspaces, with refresh hooks after VC mutations.

## Required context

1. `app/src/lib/services/fileStatusTracker.ts` — current OpenCode-backed tracker
2. `app/src/lib/git/gitService.ts` — `queryWorkingTreeStatus`, `isWorkingTreeDirty`
3. `app/src/lib/components/ProjectTreeNode.svelte` (or equivalent tree badge consumer)
4. `app/src/lib/git/versionControlRefresh.ts` — mutation scopes for invalidation
5. `app/src/lib/git/gitOpenCodeIsolation.test.ts` — keep git module free of OpenCode imports

## Implementation steps

1. Add a system-git status provider (new module under `app/src/lib/git/` or extend `fileStatusTracker`) that:
   - Resolves repo root for a workspace path
   - Maps porcelain status codes to M/A/D (and optionally `??` untracked) badges
   - Returns absolute paths consistent with project-tree conventions
2. Replace or gate OpenCode `file.status` for git-backed workspaces; retain OpenCode path only when workspace is not a git repo (if still needed for non-git workflows).
3. Subscribe to VC mutation events (commit, stage, pull, checkout, etc.) and debounce refresh of tree badges for the affected workspace.
4. Ensure AI backend `file.status` forwarding remains independent unless explicitly unified later.
5. Add unit tests for status-code → badge mapping and integration tests with temp repos.
6. Extend manual test checklist — project tree badges match VC Changes panel after stage/commit.

## Acceptance checklist

- [ ] Git-backed workspace tree badges reflect `git status --porcelain` within one refresh cycle after VC mutations.
- [ ] Non-git workspaces show no incorrect git badges (neutral or hidden).
- [ ] No new import from git modules into OpenCode/fileStatusTracker coupling (isolation test still passes or is updated intentionally).
- [ ] Performance: status refresh is debounced and does not block tree rendering.

## Dependencies

- FIX-01 recommended first (reduces editor/disk mismatch during badge refresh)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`; mark S-01 addressed in backlog.
