# FIX-11 — Porcelain v2 status parsing [DONE]

**Priority:** P2 · **Score:** 5 · **Agent:** medium · **Estimate:** ~0.75d

**Source:** Git integration code review (2026-07-04)  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

Working-tree status uses `git status --porcelain` **v1** text parsing. Quoted/octal paths are handled, but v1 has edge cases with renames, conflict states, and unusual encodings. Specs referenced v2 `-z` format; not adopted.

## Goal

Migrate to `git status --porcelain=v2 -z` (or v2 with documented delimiter strategy) for robust parsing, preserving existing `WorkingTreeStatus` shape.

## Required context

1. `app/src/lib/git/gitParse.ts` — `parseStatusPorcelain`, `splitWorkingTreeStatus`
2. `app/src/lib/git/gitService.ts` — `queryWorkingTreeStatus`
3. `app/src/lib/git/fixtures/git-status-porcelain.txt` — extend or add v2 fixtures
4. Linux octal path handling (D-11)

## Implementation steps

1. Document v2 field mapping to `ParsedStatusLine` / `WorkingTreeFileEntry` (including rename, unmerged, untracked).
2. Add `parseStatusPorcelainV2Z(stdout: string)` with NUL-delimited record parser.
3. Switch `queryWorkingTreeStatus` argv to `--porcelain=v2 -z`.
4. Keep v1 parser for fixture regression tests or remove after parity tests pass.
5. Add integration tests: rename, conflict (`UU`), untracked directory, octal-quoted paths.
6. Verify `GitChangesPanel` staged/unstaged split unchanged for common cases.

## Acceptance checklist

- [x] `queryWorkingTreeStatus` uses porcelain v2 -z.
- [x] All existing porcelain fixture tests pass or fixtures updated with equivalent v2 samples.
- [x] Rename and conflict entries appear correctly in staged/unstaged lists.
- [x] No regression in FIX-02 badge mapping if complete.

## Dependencies

- None (optional coordination with FIX-02)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
