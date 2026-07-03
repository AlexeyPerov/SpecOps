# D-02 Task 2 — Query commit file diff service

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-02](../backlog.md)  
**Prior task:** [d-02-01-unified-diff-patch-parser.md](./d-02-01-unified-diff-patch-parser.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 7 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Add `gitService` API to fetch and parse a single file’s diff for a given commit SHA (for commit detail inline diff).

## Required context

1. `app/src/lib/git/gitDiffParse.ts`
2. `app/src/lib/git/gitService.ts` — `runGit`, `queryCommitDetail`
3. Reference diff invocation: [`Diff.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Diff.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Diff.cs) — `diff --no-color --no-ext-diff --full-index --patch --unified=N`
4. Reference commit changes UI data flow: [`CommitChanges.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/CommitChanges.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/CommitChanges.axaml)

## Implementation steps

1. Add constant `DIFF_CONTEXT_LINES = 3` in `gitService.ts` or shared config module.
2. Implement `queryCommitFileDiff(repoRoot, sha, path, parentSha?: string)`:
   - For normal commits: `git diff --no-color --no-ext-diff --patch --unified=3 <parent>..<sha> -- <path>`
   - Root commit (no parent): `git show --no-color --patch --unified=3 <sha> -- <path>`
   - Use `--` separator; pass path as single argv element (reuse path normalization from phase 4).
3. On non-zero exit, map to `GitCommandError` with stderr.
4. Parse stdout via `parseUnifiedDiff`; return first file entry or throw if path not in patch.
5. Add integration test with `gitTempRepoHarness`: commit file change, fetch diff, assert added line present.
6. Export types from barrel if applicable.

## Acceptance checklist

- [ ] Integration test passes when git installed.
- [ ] Renamed file (R status) handled if present in `queryCommitDetail` — document behavior (diff old path vs new path).
- [ ] Deleted file (D) returns deletions-only diff or empty with metadata.
- [ ] Added file (A) uses `git show` or parent-less diff correctly.

## Dependencies

- [d-02-01-unified-diff-patch-parser.md](./d-02-01-unified-diff-patch-parser.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
