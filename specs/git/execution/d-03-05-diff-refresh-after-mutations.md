# D-03 Task 5 — Diff refresh after stage/unstage/commit

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-03](../backlog.md)  
**Prior task:** [d-03-04-staged-unstaged-diff-source-rules.md](./d-03-04-staged-unstaged-diff-source-rules.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 5 · **Agent:** easy · **Estimate:** ~0.5d

## Goal

Keep the diff pane synchronized after staging, unstaging, commit, and panel refresh — without requiring the user to re-click the file.

## Required context

1. `GitChangesPanel` mutations + `onMutation` / `versionControlRefresh`
2. `refreshAfterMutation` patterns from phase 3
3. Reference refresh after stage: [`WorkingCopy.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/WorkingCopy.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/WorkingCopy.axaml) (ViewModel invalidates selected change diff)

## Implementation steps

1. After successful stage/unstage/commit, if `activeDiffPath` still exists in either list, reload diff with updated source (file may have moved lists — re-resolve source from which list contains path).
2. If path removed (fully staged then committed, or reverted), clear diff or select next available file automatically.
3. Hook into existing `loadWorkingTreeStatus` completion to trigger diff reload when `refreshToken` changes.
4. Avoid double-fetch: debounce reload within same tick as status load.
5. Update `manual-test-checklist.md` Changes section: stage file while diff open, verify pane updates.

## Acceptance checklist

- [ ] Stage all unstaged while viewing diff → diff clears or switches to staged view.
- [ ] Commit clears diff when working tree clean.
- [ ] Toolbar Refresh updates diff content for unchanged selection.
- [ ] Manual checklist updated.

## Dependencies

- [d-03-04-staged-unstaged-diff-source-rules.md](./d-03-04-staged-unstaged-diff-source-rules.md)

## D-03 exit criteria

- [ ] Changes panel shows live working-copy diffs for text files.
- [ ] Staged/unstaged semantics correct including partial stage.
- [ ] All D-03 tasks marked `[DONE]`.

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
