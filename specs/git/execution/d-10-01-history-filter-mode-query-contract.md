# D-10 Task 1 — History filter mode query contract [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-10](../backlog.md) — History across all branches/remotes  
**Spec:** [version-control-idea.md](../version-control-idea.md) §3 #5  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 7 · **Agent:** medium · **Estimate:** ~0.75d

## Goal

Extend commit query layer with explicit history scope modes (current branch, all local branches, include remotes) while preserving current-branch default.

## Required context

1. Existing `queryCommits` contract in `app/src/lib/git/gitService.ts`
2. History panel data load path in `GitHistoryPanel.svelte`
3. Commit graph layout assumptions in `commitGraphLayout.ts`
4. Reference graph filter mode UI: [`Views/FilterModeInGraph.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/FilterModeInGraph.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/FilterModeInGraph.axaml)
5. Reference commit query command: [`Commands/QueryCommits.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryCommits.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryCommits.cs)

## Implementation steps

1. Add `HistoryFilterMode` type in `types.ts`:
   - `"current-branch"`
   - `"all-branches"`
   - `"all-branches-and-remotes"`
2. Extend `queryCommits` options with `filterMode` and map to git args (`--all`, remote refs behavior).
3. Keep existing pagination/limit behavior unchanged.
4. Ensure merge parents and SHAs remain stable so graph layout still works.
5. Add unit tests for argv construction in each mode and fallback default.

## Acceptance checklist

- [x] `queryCommits` supports filter mode without breaking existing callers.
- [x] Current default remains current-branch mode.
- [x] All mode variants are test-covered for argv generation.
- [x] No regressions in commit parse behavior.

## Dependencies

- D-01 graph layout and existing history panel integration

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
