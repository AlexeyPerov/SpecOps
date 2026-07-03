# D-03 Task 2 — Changes panel split layout

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-03](../backlog.md)  
**Prior task:** [d-03-01-query-working-tree-file-diff.md](./d-03-01-query-working-tree-file-diff.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 7 · **Agent:** medium · **Estimate:** ~1d

## Goal

Restructure `GitChangesPanel` into a left/right split: unstaged + staged lists on the left, diff viewer on the right (below commit message area or beside lists — match reference working-copy proportions).

## Required context

1. `app/src/lib/components/GitChangesPanel.svelte` — current full-width lists + commit box
2. `app/src/lib/components/GitTextDiffView.svelte`
3. Reference layout: [`WorkingCopy.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/WorkingCopy.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/WorkingCopy.axaml) — left lists, right diff stack
4. `VersionControlView.svelte` Changes section sizing

## Implementation steps

1. Adopt grid layout:
   - Row 1 (optional): commit message + Commit button (keep at bottom or top — prefer bottom to match reference “commit area below changes”).
   - Main area: column 1 = unstaged + staged lists (existing markup, narrowed); column 2 = `GitTextDiffView` placeholder.
2. Minimum widths: lists min 200px, diff min 300px; use CSS grid `minmax`.
3. Preserve stage/unstage buttons, multi-select, read-only/disabled states from MVP.
4. When panel read-only (bare repo), diff pane disabled with banner consistent with phase 4.
5. Do **not** wire diff loading yet — static placeholder “Select a file to view changes”.
6. Svelte autofixer clean.

## Acceptance checklist

- [ ] Changes section shows list + diff columns at typical VC panel width.
- [ ] Commit message + Commit button still functional.
- [ ] Stage/unstage unchanged from MVP behavior.
- [ ] Layout survives narrow panel (lists stack above diff below breakpoint if needed).

## Dependencies

- [d-03-01-query-working-tree-file-diff.md](./d-03-01-query-working-tree-file-diff.md)
- [d-02-03-git-text-diff-view-component.md](./d-02-03-git-text-diff-view-component.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
