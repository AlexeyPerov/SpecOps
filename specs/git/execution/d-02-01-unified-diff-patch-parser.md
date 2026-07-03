# D-02 Task 1 — Unified diff patch parser [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-02](../backlog.md) — Inline diff on commit select  
**Spec:** [version-control-idea.md](../version-control-idea.md) §3 #14, §7.3  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 9 · **Agent:** heavy · **Estimate:** ~1.5d

## Goal

Parse `git diff` unified patch stdout into a structured model (hunks, lines, added/deleted counts, binary/LFS detection) reusable by commit and working-copy diff tasks.

## Required context

1. Existing parse patterns: `app/src/lib/git/gitParse.ts`, `types.ts`
2. Reference parser and result types: [`Diff.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Diff.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Diff.cs) — header lines, `@@` hunks, added/deleted/normal lines, binary detection, `TextDiff` / `TextDiffLine`

## Implementation steps

1. Add types to `app/src/lib/git/types.ts` (or `gitDiffTypes.ts` if cleaner):
   - `DiffLineKind`: `"context" | "added" | "deleted" | "hunk-header" | "meta"`
   - `DiffLine`: `{ kind, content, oldLineNo?, newLineNo? }`
   - `DiffHunk`: `{ header, lines: DiffLine[] }`
   - `ParsedTextDiff`: `{ path, oldPath?, hunks, addedLines, deletedLines, isBinary, oldMode?, newMode? }`
2. Add `app/src/lib/git/gitDiffParse.ts` with `parseUnifiedDiff(stdout: string): ParsedTextDiff[]` supporting multi-file patches.
3. Handle:
   - `diff --git a/... b/...` headers
   - `index` lines (optional)
   - `---` / `+++` paths
   - `@@ -l,s +l,s @@` hunk headers with line number tracking
   - `\ No newline at end of file`
   - `Binary files ... differ` → `isBinary: true`, empty hunks
4. Add fixtures under `app/src/lib/git/fixtures/`:
   - `git-diff-unified-single-file.txt`
   - `git-diff-binary.txt`
   - `git-diff-multi-file.txt`
5. Add `app/src/lib/git/gitDiffParse.test.ts` with fixture assertions for line counts and hunk boundaries.

## Acceptance checklist

- [ ] Parser tests pass for all fixtures.
- [ ] Multi-file patch returns one `ParsedTextDiff` per file.
- [ ] Binary patch sets `isBinary` without throwing.
- [ ] No shell invocation in parser module (pure string in/out).

## Dependencies

- MVP phases 0–2 complete.

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
