# D-02 Task 5 — Binary and large-file diff states

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-02](../backlog.md)  
**Prior task:** [d-02-04-commit-detail-split-layout-with-diff.md](./d-02-04-commit-detail-split-layout-with-diff.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 5 · **Agent:** easy · **Estimate:** ~0.5d

## Goal

Handle non-textual diffs gracefully in commit detail (binary files, empty diffs, oversized patch truncation) without breaking the split layout.

## Required context

1. `GitTextDiffView.svelte`, `GitCommitDetailPanel.svelte`
2. `parseUnifiedDiff` binary detection
3. Reference binary/LFS handling: [`Diff.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Diff.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Diff.cs) — `IsBinary`, LFS specifier branches
4. Reference image diff (out of scope UI): [`ImageDiffView.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/ImageDiffView.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/ImageDiffView.axaml)

## Implementation steps

1. In `GitTextDiffView`, when `diff.isBinary`, show centered message: “Binary file — diff not shown” (no hex dump).
2. When patch parses to zero hunks and not binary, show “No diff content” (mode-only or submodule edge case).
3. Add optional guard in `queryCommitFileDiff`: if stdout length > 512 KiB, return typed `GitDiffTooLargeError` instead of parsing — constant documented in `gitService.ts`.
4. In commit detail panel, map `GitDiffTooLargeError` to friendly message suggesting external diff tool (future backlog).
5. Add fixture + test for binary diff path; add unit test for size guard (mock long string).
6. Update `manual-test-checklist.md` with one binary/large-file manual step under History section.

## Acceptance checklist

- [ ] Binary file selection shows placeholder, not garbled text.
- [ ] Oversized diff does not freeze UI.
- [ ] Tests cover binary fixture and size guard.
- [ ] Manual checklist updated.

## Dependencies

- [d-02-04-commit-detail-split-layout-with-diff.md](./d-02-04-commit-detail-split-layout-with-diff.md)

## D-02 exit criteria

- [ ] Commit detail shows inline unified diff for text files.
- [ ] Binary/large files handled with clear empty states.
- [ ] All D-02 tasks marked `[DONE]`.

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
