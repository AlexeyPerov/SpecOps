# FIX-10 — gitService modularization

**Priority:** P2 · **Score:** 4 · **Agent:** medium · **Estimate:** ~1d

**Source:** Git integration code review (2026-07-04)  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

`gitService.ts` is ~1100 lines combining IPC wrappers, argv builders, parsing orchestration, domain error classes, and remote/stash/tag APIs. High coupling makes navigation and review harder despite good test coverage.

## Goal

Split implementation into focused modules while preserving the public API surface (re-export from `gitService.ts` or thin barrel).

## Required context

1. `app/src/lib/git/gitService.ts`
2. `app/src/lib/git/gitService.test.ts` — large test suite
3. All importers of `gitService` (grep `from "../git/gitService"`)

## Suggested module split

| Module | Responsibility |
|---|---|
| `gitRun.ts` | `runGit`, `cancelGitCommand`, `checkGitAvailable`, logging |
| `gitRepo.ts` | `resolveRepoRoot`, bare/dirty probes, branch/upstream |
| `gitHistory.ts` | `queryCommits`, `queryCommitDetail`, `queryCommitFileDiff`, builders |
| `gitWorkingTree.ts` | status, stage/unstage, diffs, `createCommit` |
| `gitRemotes.ts` | remotes, fetch/pull/push, ahead/behind |
| `gitTagsStash.ts` | tags, stash CRUD |
| `gitErrors.ts` | error classes currently in gitService |
| `gitService.ts` | re-exports only (backward compatible) |

## Implementation steps

1. Create modules incrementally; move functions with tests green after each slice.
2. Keep `gitService.ts` as stable import path — no mass import updates required.
3. Avoid behavior changes; refactor only.
4. Split `gitService.test.ts` into matching test files or keep single file initially.
5. Update `gitOpenCodeIsolation.test.ts` if import graph changes.

## Acceptance checklist

- [ ] All existing exports from `gitService.ts` remain available at same paths.
- [ ] Full vitest suite passes without behavior changes.
- [ ] No new circular imports between git modules.
- [ ] Largest new module is under ~400 lines.

## Dependencies

- None (pure refactor; best done when no concurrent git feature work)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
