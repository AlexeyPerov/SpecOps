# D-01 Task 4 — Integrate graph column into history panel

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-01](../backlog.md)  
**Prior task:** [d-01-03-commit-graph-svg-component.md](./d-01-03-commit-graph-svg-component.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 7 · **Agent:** medium · **Estimate:** ~1d

## Goal

Replace the flat history list-only layout with a graph column + commit rows split view, preserving existing selection and refresh behavior.

## Required context

1. `app/src/lib/components/GitHistoryPanel.svelte` — current flat list
2. `app/src/lib/components/GitCommitGraphColumn.svelte`
3. `app/src/lib/git/commitGraphLayout.ts`
4. Reference layout: [`Histories.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/Histories.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/Histories.axaml) — `CommitGraph` overlay/grid beside `HistoriesCommitList`
5. `app/src/lib/components/VersionControlView.svelte` — history section host

## Implementation steps

1. In `GitHistoryPanel.svelte`, after commits load, compute `$derived` layout via `buildCommitGraphLayout(commits)`.
2. Restructure list markup into a two-column row template per commit:
   - Left: fixed-width graph gutter containing a single shared `GitCommitGraphColumn` (absolute/sticky) **or** per-row dot alignment — prefer **one SVG** aligned to list (reference uses single graph control spanning list height).
3. Recommended approach (match reference):
   - Outer scroll container wraps both graph SVG and rows.
   - Graph SVG `position: sticky; left: 0` within scroll area.
   - Each commit row has left padding equal to graph width so text does not overlap lanes.
4. Pass `selectedSha` into graph column for selection ring.
5. Preserve existing props/callbacks: `onSelectCommit`, `refreshToken`, keyboard navigation on rows.
6. Loading/error/empty states unchanged except add zero-width gutter when no commits.
7. Update any history panel tests if present; run `npm run check`.

## Acceptance checklist

- [ ] History panel shows lane graph for repo with merge commits.
- [ ] Clicking a commit row still selects and notifies parent (`GitCommitDetailPanel`).
- [ ] Refresh token reloads both commits and graph layout.
- [ ] Flat-list-only regression: linear repo still readable (single lane).
- [ ] Svelte autofixer clean.

## Dependencies

- [d-01-03-commit-graph-svg-component.md](./d-01-03-commit-graph-svg-component.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
