# D-01 Task 1 — Commit graph layout algorithm [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-01](../backlog.md) — Commit graph / lane layout  
**Spec:** [version-control-idea.md](../version-control-idea.md) §3 #5, §7.3  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 9 · **Agent:** heavy · **Estimate:** ~1.5d

## Goal

Implement a pure TypeScript commit-graph layout engine that turns an ordered commit list (newest-first, with parent SHAs) into lane assignments, merge curves, and dot positions suitable for SVG rendering. This replaces the flat history list’s implicit ordering with explicit graph geometry.

## Required context

1. Existing commit model: `app/src/lib/git/types.ts` (`CommitSummary`, parent fields from `queryCommits`)
2. Existing log query: `app/src/lib/git/gitService.ts` — `queryCommits`
3. Reference graph generation: [`CommitGraph.cs` (Models)](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Models/CommitGraph.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Models/CommitGraph.cs) — `Generate`, `PathHelper`, lane/color assignment
4. Reference rendering primitives (for output shape): [`CommitGraph.cs` (Views)](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/CommitGraph.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/CommitGraph.cs) — `Path`, `Link`, `Dot`, `DotType`
5. Reference history integration: [`Histories.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/Histories.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/Histories.axaml) — graph column beside commit list

## Implementation steps

1. Add `app/src/lib/git/commitGraphLayout.ts` with exported types:
   - `CommitGraphDot` — `{ rowIndex, lane, colorIndex, kind: "default" | "head" | "merge", sha }`
   - `CommitGraphSegment` — vertical/horizontal lane segments between rows
   - `CommitGraphCurve` — quadratic or polyline merge links (start/control/end or point list)
   - `CommitGraphLayoutResult` — `{ dots, segments, curves, laneCount, rowHeight }`
2. Implement `buildCommitGraphLayout(commits: CommitSummary[], options?)`:
   - Input commits ordered newest-first (same as `GitHistoryPanel`).
   - Walk commits top-to-bottom; assign lanes using a path-helper approach modeled on reference `PathHelper` / unsolved-path stack.
   - On merge commits, fork lanes for non-first parents; close lanes when paths end.
   - Assign `colorIndex` via round-robin palette (fixed 8 colors; no theme wiring in this task).
   - Mark `kind: "head"` for row 0; `kind: "merge"` when `parents.length > 1`.
3. Use fixed geometry constants aligned with planned UI row height (e.g. `ROW_HEIGHT = 26`, `LANE_WIDTH = 12`, `DOT_RADIUS = 4`) — document in file header.
4. Handle edge cases without throwing:
   - Single commit, linear history, empty list
   - Octopus merges (cap visible merge lanes if needed; document limit)
   - Missing parent in fetched window (truncated log) — treat as lane terminator
5. Do **not** render DOM/SVG in this task — layout only.

## Acceptance checklist

- [x] `buildCommitGraphLayout` returns stable lane assignments for a linear 5-commit fixture.
- [x] Merge commit fixture produces at least one curve/link and multiple active lanes.
- [x] Truncated history (parent SHA not in list) does not crash; lane closes gracefully.
- [x] No imports from Svelte or Tauri in `commitGraphLayout.ts`.
- [x] Public API documented with JSDoc describing coordinate system (origin top-left, y grows down).

## Dependencies

- MVP phases 0–2 complete (`queryCommits` with parent SHAs available).

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
