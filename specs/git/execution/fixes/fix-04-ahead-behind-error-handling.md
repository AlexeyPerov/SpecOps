# FIX-04 — Ahead/behind error handling

**Priority:** P1 · **Score:** 6 · **Agent:** low · **Estimate:** ~0.25d

**Source:** Git integration code review (2026-07-04)  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

`queryAheadBehind` returns `null` for **any** non-zero exit code, including real failures (lock conflict, corrupt repo, transient errors). Callers treat `null` as “no upstream,” hiding errors in the VC toolbar and Workspace Manager git column.

## Goal

Distinguish “no upstream configured” from genuine git failures; propagate or log the latter.

## Required context

1. `app/src/lib/git/gitService.ts` — `queryAheadBehind`
2. `app/src/lib/git/gitParse.ts` — `parseAheadBehindCount`
3. `app/src/lib/components/VersionControlView.svelte` — branch header ahead/behind display
4. `app/src/lib/git/repositoryStatusSummary.ts` — composes ahead/behind for workspace column

## Implementation steps

1. Add helper `isNoUpstreamAheadBehindError(response: RunGitResponse): boolean` matching known stderr (e.g. `no upstream configured`, `unknown revision`).
2. Change `queryAheadBehind` to:
   - Return `null` only when no upstream (exit 128 + known stderr, or empty/unparseable success edge cases documented in tests).
   - Throw `GitCommandError` for other non-zero exits.
3. Update `queryRepositoryStatusSummary` to catch ahead/behind errors optionally (omit counts but log diagnostic) or propagate — choose one consistent UX.
4. Update `VersionControlView` branch header to show a subtle error state when ahead/behind query fails (not silently omit).
5. Extend `gitService.test.ts` with cases: no upstream → null; lock error → throw; malformed stdout → null or throw per contract.

## Acceptance checklist

- [ ] “No upstream” still returns `null` without throwing.
- [ ] Non-upstream failures are logged and surfaced (toolbar or diagnostic), not masked as null.
- [ ] Workspace Manager column behavior is consistent with VC toolbar.
- [ ] Existing ahead/behind display tests updated.

## Dependencies

- None

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
