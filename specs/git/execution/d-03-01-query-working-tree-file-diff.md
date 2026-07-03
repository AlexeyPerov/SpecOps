# D-03 Task 1 — Query working-tree file diff service [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-03](../backlog.md) — Full working-copy diff viewer  
**Spec:** [version-control-idea.md](../version-control-idea.md) §3 #14, §7.3  
**Prior feature:** D-02 diff parser and `GitTextDiffView`  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 7 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Add gitService methods to diff a working-tree file against HEAD or the index (staged), reusing the unified diff parser from D-02.

## Required context

1. `app/src/lib/git/gitDiffParse.ts`, `gitService.ts`
2. `queryWorkingTreeStatus` — staged vs unstaged paths
3. Reference local changes diff: [`QueryLocalChanges.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryLocalChanges.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryLocalChanges.cs)
4. Reference diff command builder: [`Diff.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Diff.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Diff.cs)

## Implementation steps

1. Add enum or union `WorkingTreeDiffSource = "unstaged" | "staged"`.
2. Implement `queryWorkingTreeFileDiff(repoRoot, path, source)`:
   - **Unstaged:** `git diff --no-color --patch --unified=3 HEAD -- <path>`
   - **Staged:** `git diff --no-color --patch --unified=3 --cached -- <path>`
   - Untracked file (unstaged only): `git diff --no-color --patch --unified=3 /dev/null` equivalent — use `git diff --no-index` only if needed; prefer documenting `git diff HEAD -- path` behavior for untracked via `git add -N` **not** required — for pure untracked, use `git diff --no-index -- /dev/null path` on Unix and `--no-index NUL path` on Windows via Rust helper if necessary, or show “Untracked — full file is new” synthetic diff (document choice).
3. Reuse `GitDiffTooLargeError` from D-02.
4. Integration tests: modify file, stage partially, assert unstaged vs staged diffs differ.

## Acceptance checklist

- [ ] Staged diff shows index vs HEAD changes only.
- [ ] Unstaged diff shows working tree vs index (or HEAD for simplified model — document exact git command semantics in JSDoc).
- [ ] Parser integration returns `ParsedTextDiff`.
- [ ] Paths with spaces work on Windows + macOS in tests.

## Dependencies

- [d-02-01-unified-diff-patch-parser.md](./d-02-01-unified-diff-patch-parser.md) (D-02 parser complete)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
