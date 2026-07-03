# D-01 Task 2 — Graph fixtures and unit tests [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-01](../backlog.md)  
**Prior task:** [d-01-01-commit-graph-layout-algorithm.md](./d-01-01-commit-graph-layout-algorithm.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 7 · **Agent:** medium · **Estimate:** ~1d

## Goal

Lock graph layout behavior with deterministic fixtures and Vitest coverage so later UI tasks can rely on stable geometry snapshots.

## Required context

1. Task 1 output: `app/src/lib/git/commitGraphLayout.ts`
2. Existing fixture pattern: `app/src/lib/git/fixtures/`, `gitParse.test.ts`
3. Reference commit ordering input: [`QueryCommits.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryCommits.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryCommits.cs)

## Implementation steps

1. Add `app/src/lib/git/fixtures/commit-graph-linear.json` — 5 commits, single parent chain.
2. Add `app/src/lib/git/fixtures/commit-graph-merge.json` — feature branch merged into main (at least one merge commit, 7+ commits).
3. Add `app/src/lib/git/fixtures/commit-graph-truncated.json` — newest commits present but an older parent missing from array (simulates log limit cutoff).
4. Add `app/src/lib/git/commitGraphLayout.test.ts`:
   - Assert `laneCount`, dot count, and lane indices for linear fixture.
   - Assert merge fixture has `kind: "merge"` dot and `curves.length > 0`.
   - Assert truncated fixture completes without throw and `laneCount >= 1`.
   - Snapshot or explicit coordinate assertions for first 3 rows of linear fixture (avoid brittle full snapshots if unnecessary).
5. Optional integration: extend `gitTempRepoHarness` to create a real merge repo and verify layout accepts `queryCommits` output when git installed (`describeIfGitInstalled`).
6. Document fixtures in `app/src/lib/git/fixtures/README.md` (which git topology each represents).

## Acceptance checklist

- [x] `npm test` passes locally.
- [x] Tests run without git for JSON fixtures; git integration section skips when git missing.
- [x] Fixture README updated.
- [x] No Svelte components added in this task.

## Dependencies

- [d-01-01-commit-graph-layout-algorithm.md](./d-01-01-commit-graph-layout-algorithm.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
