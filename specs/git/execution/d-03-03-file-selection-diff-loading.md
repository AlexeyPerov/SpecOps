# D-03 Task 3 — File selection drives diff load [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-03](../backlog.md)  
**Prior task:** [d-03-02-changes-panel-split-layout.md](./d-03-02-changes-panel-split-layout.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 6 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Connect file row selection in unstaged/staged lists to `queryWorkingTreeFileDiff` and render results in the diff pane.

## Required context

1. Split `GitChangesPanel` from task 2
2. `queryWorkingTreeFileDiff`
3. Reference selection → diff binding: [`WorkingCopy.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/WorkingCopy.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/WorkingCopy.axaml) + ViewModel working copy selection handlers

## Implementation steps

1. Track `activeDiffPath: string | null` and `activeDiffSource: WorkingTreeDiffSource | null`.
2. On row click (single-select for diff, keep multi-select for stage actions — clarify UX: clicking row selects for diff; checkbox or modifier for multi-select if existing; if single-select only today, use selected row for diff).
3. Load diff in `$effect` when path + source change; abort previous request.
4. Show loading state on diff pane; errors via `reportGitError`.
5. Default selection: first unstaged file if any, else first staged file after status load.
6. Clear diff when file disappears after stage/unstage (path no longer in lists).

## Acceptance checklist

- [ ] Clicking unstaged file shows working-tree diff in right pane.
- [ ] Clicking staged file shows staged diff.
- [ ] Rapid selection does not show stale diff (abort works).
- [ ] Clean repo shows diff empty state.

## Dependencies

- [d-03-02-changes-panel-split-layout.md](./d-03-02-changes-panel-split-layout.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
