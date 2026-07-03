# D-01 Task 3 — Commit graph SVG column component [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-01](../backlog.md)  
**Prior task:** [d-01-02-graph-fixtures-and-unit-tests.md](./d-01-02-graph-fixtures-and-unit-tests.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 8 · **Agent:** heavy · **Estimate:** ~1.5d

## Goal

Create a reusable Svelte component that renders the graph layout as an SVG column (lanes, merge curves, commit dots) using app design tokens.

## Required context

1. `app/src/lib/git/commitGraphLayout.ts` — layout result types
2. Reference custom control rendering: [`CommitGraph.cs` (Views)](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/CommitGraph.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/CommitGraph.cs) — `DrawCurves`, `DrawAnchors`
3. Reference ref badge colors: [`CommitRefsPresenter.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/CommitRefsPresenter.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/CommitRefsPresenter.cs)
4. Existing history row styling: `app/src/lib/components/GitHistoryPanel.svelte`

## Implementation steps

1. Create `app/src/lib/components/GitCommitGraphColumn.svelte` with props:
   - `layout: CommitGraphLayoutResult`
   - `rowHeight: number` (default 26)
   - `selectedSha?: string | null`
   - `highlightedShas?: Set<string>` (for task 6; may be empty set initially)
2. Render SVG with:
   - `<path>` or `<polyline>` for lane segments and merge curves
   - `<circle>` for commit dots; distinct stroke/fill for `head` and `merge` kinds
   - Selected commit dot ring (CSS class using existing accent token)
3. Define a fixed 8-color palette via CSS variables or inline colors that work in light/dark shell (match `--color-*` tokens used elsewhere in VC panels).
4. Set SVG `width` to `laneCount * LANE_WIDTH + padding`; `height` to `commits.length * rowHeight`.
5. Use `role="img"` and `aria-hidden="true"` (graph is decorative; commit info remains in list rows).
6. Run Svelte autofixer on the component until clean.

## Acceptance checklist

- [ ] Component renders linear + merge fixtures in Storybook-like isolation (may use a minimal dev-only route or unit test with `@testing-library/svelte` if project supports it; otherwise manual verification note in changelog).
- [ ] Selected SHA shows visible selection ring.
- [ ] SVG scales correctly when `laneCount` is 1 vs 4+.
- [ ] No performance warnings for 500-row layout in `$derived` (layout passed from parent, not recomputed here).

## Dependencies

- [d-01-02-graph-fixtures-and-unit-tests.md](./d-01-02-graph-fixtures-and-unit-tests.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
