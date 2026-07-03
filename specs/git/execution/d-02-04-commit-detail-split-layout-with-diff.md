# D-02 Task 4 — Commit detail split layout with diff

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-02](../backlog.md)  
**Prior task:** [d-02-03-git-text-diff-view-component.md](./d-02-03-git-text-diff-view-component.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 7 · **Agent:** medium · **Estimate:** ~1d

## Goal

Wire commit file selection to inline diff loading in `GitCommitDetailPanel`, using a three-pane layout: metadata (optional collapse), file list, diff viewer.

## Required context

1. `app/src/lib/components/GitCommitDetailPanel.svelte` — current metadata + file list, no diff
2. `app/src/lib/components/GitTextDiffView.svelte`
3. `queryCommitFileDiff` from `gitService.ts`
4. Reference layout: [`CommitChanges.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/CommitChanges.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/CommitChanges.axaml) — file list left, diff right with splitter
5. `VersionControlView.svelte` — history/detail split

## Implementation steps

1. Restructure `GitCommitDetailPanel` body:
   - Top: existing metadata block (subject, author, SHA, message) — may compress to single column on narrow width.
   - Bottom split: file list (narrow) | diff viewer (flex 1) with draggable splitter or fixed 30/70 ratio (match app split patterns).
2. Track `selectedFilePath: string | null` — default to first file when detail loads.
3. On file row click, call `queryCommitFileDiff(repoRoot, sha, path, parentSha)`:
   - Pass `parentSha` from `detail.parents[0]` when available.
   - Abort in-flight fetch on rapid selection change (`AbortController` in `$effect`).
4. Pass result to `GitTextDiffView`; show loading spinner on diff pane during fetch.
5. Surface errors via inline diff error + `reportGitError` for toast (consistent with phase 4).
6. Keyboard: Up/Down on file list changes selection and diff.

## Acceptance checklist

- [ ] Selecting commit in history shows file list; selecting file shows unified diff.
- [ ] Switching commits resets selection to first file and loads new diff.
- [ ] Empty commit (no files) shows empty diff pane message.
- [ ] `npm run check` passes; Svelte autofixer clean.

## Dependencies

- [d-02-03-git-text-diff-view-component.md](./d-02-03-git-text-diff-view-component.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
