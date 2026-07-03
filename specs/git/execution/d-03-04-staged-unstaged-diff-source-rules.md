# D-03 Task 4 — Staged vs unstaged diff source rules [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-03](../backlog.md)  
**Prior task:** [d-03-03-file-selection-diff-loading.md](./d-03-03-file-selection-diff-loading.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 6 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Correctly handle files that appear in both staged and unstaged sections (partial stage) and untracked files, with explicit diff source labeling in the UI.

## Required context

1. `queryWorkingTreeFileDiff`, `queryWorkingTreeStatus` status codes
2. `GitChangesPanel` selection logic
3. Reference status model: [`QueryLocalChanges.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryLocalChanges.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryLocalChanges.cs)
4. D-02 binary/large diff states

## Implementation steps

1. When same path exists in both lists (possible with partial staging / MM status), tag rows with source list; diff uses list context:
   - Selection from **Unstaged** → `source: "unstaged"`
   - Selection from **Staged** → `source: "staged"`
2. Add diff pane subtitle: “Staged changes” vs “Unstaged changes” (and “Untracked file” when applicable).
3. Untracked files: implement chosen strategy from D-03 task 1 JSDoc (synthetic all-added diff or `--no-index`); show clear label.
4. Renamed/copied statuses: use path shown in list row for diff argv.
5. Unit tests for source resolution helper (pure function given path + active list).

## Acceptance checklist

- [ ] Partially staged file shows different diffs when selected from staged vs unstaged list.
- [ ] Untracked file shows sensible new-file diff or documented placeholder.
- [ ] Subtitle updates with source.
- [ ] Tests for source helper pass.

## Dependencies

- [d-03-03-file-selection-diff-loading.md](./d-03-03-file-selection-diff-loading.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
