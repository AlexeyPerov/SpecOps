# FIX-06 — Per-repo git command queue

**Priority:** P1 · **Score:** 7 · **Agent:** medium · **Estimate:** ~0.75d

**Source:** Git integration code review (2026-07-04)  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

Workspace Manager uses a **global serial queue** for all git commands (`workspaceManagerGitColumn.ts`), while the Version Control tab runs git **in parallel** with no shared coordination. Concurrent operations on the same repository (VC commit + column refresh + fetch) can hit `.git/index.lock` and fail unpredictably.

## Goal

Serialize git subprocess invocations **per repository root** (not app-wide), shared by VC panels, workspace manager column, and any future callers.

## Required context

1. `app/src/lib/git/workspaceManagerGitColumn.ts` — current global `gitCommandQueue`
2. `app/src/lib/git/gitService.ts` — central `runGit` entry point
3. `app/src-tauri/src/git.rs` — subprocess spawn (queue stays TS-side unless Rust mutex needed)

## Implementation steps

1. Add `app/src/lib/git/gitCommandQueue.ts`:
   - `enqueueGitCommandForRepo(repoRoot: string, fn: () => Promise<T>): Promise<T>`
   - Per-repo promise chains; unrelated repos run concurrently.
   - `resetGitCommandQueueForTests()` for unit tests.
2. Wrap `runGit` (and `createCommit` invoke path if separate) to enqueue by normalized `repoRoot`.
3. Migrate `workspaceManagerGitColumn.ts` to use shared queue module; remove duplicate global queue.
4. Document that parallel git on **different** repos is allowed; same repo is FIFO.
5. Add tests: same-repo commands serialize; different-repo commands can overlap (mock timing).
6. Optional: detect `index.lock` / `Unable to create` stderr in `gitErrorUi.ts` with retry hint.

## Acceptance checklist

- [ ] Two rapid git calls for the same `repoRoot` never overlap subprocess execution.
- [ ] Git calls for different repos can proceed concurrently.
- [ ] Workspace Manager column and VC tab share the same queue.
- [ ] No regression to cancellation (cancel still targets the active in-flight command for that repo).

## Dependencies

- D-12 cancellation (complete)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
