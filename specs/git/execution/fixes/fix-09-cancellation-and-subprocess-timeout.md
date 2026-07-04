# FIX-09 — Cancellation breadth and subprocess timeout

**Priority:** P2 · **Score:** 7 · **Agent:** medium · **Estimate:** ~1d

**Source:** Git integration code review (2026-07-04)  
**Prior work:** [d-12-01-cancel-in-flight-git-processes.md](../d-12-01-cancel-in-flight-git-processes.md)  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

1. Cancellation covers toolbar fetch/pull/push only — not commit, tag push/delete, or long local queries (large log/diff).
2. No subprocess **timeout** — hung network or credential wait relies on manual cancel.
3. `git_commit_with_message` has no `commandId` path.

## Goal

Extend cancellation and optional timeouts to long-running git operations; fail hung commands with clear errors.

## Required context

1. `app/src-tauri/src/git.rs` — registry, `execute_git_with_options`
2. `app/src/lib/git/gitService.ts` — `createCommit`, tag remote ops
3. `app/src/lib/components/VersionControlView.svelte`, `GitTagsPanel.svelte`
4. `app/src/lib/git/gitErrorUi.ts` — timeout/cancel messaging

## Implementation steps

1. **Rust timeout (optional per request):**
   - Extend `RunGitRequest` with optional `timeoutMs`.
   - On timeout, kill child, set `cancelled` or new `timedOut` flag on response.
2. **Commit cancellation:**
   - Add optional `commandId` to `git_commit_with_message` or route commit through cancellable `run_git` with temp file on TS side if simpler.
3. **Tag remote ops:**
   - Pass `commandId` through `pushTag`, `deleteRemoteTag`; wire cancel in `GitTagsPanel` when `remoteOpBusy`.
4. **Default timeouts for remote ops:**
   - e.g. 5–10 minute ceiling on fetch/pull/push/tag network calls (configurable constant).
5. Map timeout to `GitCommandError` or dedicated error class; toast via `reportGitError`.
6. Tests: Rust timeout kills process; TS maps timedOut response; cancel during tag push.

## Acceptance checklist

- [ ] User can cancel an in-flight commit when VC shows busy state (if UI exposes it).
- [ ] Tag push/delete remote respects cancel when busy.
- [ ] Remote operations auto-fail after configured timeout with clear message.
- [ ] Short local commands (status, single-file diff) remain without timeout by default.

## Dependencies

- D-12 (complete)
- FIX-03 Phase C overlaps tag cancel wiring

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
