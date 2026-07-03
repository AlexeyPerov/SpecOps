# D-10 Task 2 — History filter UI and branch/remote scopes

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-10](../backlog.md) — History across all branches/remotes  
**Prior task:** [d-10-01-history-filter-mode-query-contract.md](./d-10-01-history-filter-mode-query-contract.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 8 · **Agent:** heavy · **Estimate:** ~1.0d

## Goal

Expose selectable history scope controls in the History panel and refresh commit list/graph rendering accordingly.

## Required context

1. `app/src/lib/components/GitHistoryPanel.svelte` controls and commit rendering
2. `queryCommits` filter mode options from Task 1
3. `app/src/lib/components/GitCommitGraphColumn.svelte` and lane scaling behavior
4. Reference scope picker UX: [`Views/FilterModeInGraph.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/FilterModeInGraph.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/FilterModeInGraph.axaml)
5. Reference history page composition: [`Views/Histories.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/Histories.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/Histories.axaml)

## Implementation steps

1. Add filter mode UI control in History toolbar (segmented control or select).
2. Persist selected mode per repository/session (same store style as other VC prefs).
3. Reload commit list on mode change with loading state and cancellation of stale requests.
4. Keep current commit selection when possible; if missing in new scope, fallback to first row.
5. Verify graph column rendering remains aligned and performs acceptably with wider `--all` histories.
6. Update manual checklist for scope mode switching.

## Acceptance checklist

- [ ] User can switch between current branch and all-history scopes in History panel.
- [ ] Mode change updates both commit list and graph column consistently.
- [ ] Rapid mode toggles do not leave stale/overlapping request state.
- [ ] Selection fallback behavior is deterministic.

## Dependencies

- [d-10-01-history-filter-mode-query-contract.md](./d-10-01-history-filter-mode-query-contract.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
