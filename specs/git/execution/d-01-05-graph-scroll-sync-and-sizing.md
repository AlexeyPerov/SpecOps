# D-01 Task 5 — Graph scroll sync and row sizing [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-01](../backlog.md)  
**Prior task:** [d-01-04-integrate-graph-into-history-panel.md](./d-01-04-integrate-graph-into-history-panel.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 6 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Ensure the graph SVG stays vertically aligned with commit rows during scroll and resize, including when the history panel is short or the commit list hits the 500-commit cap.

## Required context

1. Integrated history panel from task 4
2. Reference graph layout record: [`CommitGraphLayout` (Models)](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Models/CommitGraph.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Models/CommitGraph.cs) — `StartY`, `ClipWidth`, `RowHeight`
3. Reference code-behind scroll hooks: [`Histories.axaml.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/Histories.axaml.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/Histories.axaml.cs) — `OnCommitGraphLoaded`, layout updated handlers

## Implementation steps

1. Share a single `ROW_HEIGHT` constant between `commitGraphLayout.ts` and `GitHistoryPanel.svelte` (export from layout module).
2. Set each commit row CSS height to exactly `ROW_HEIGHT` px; remove conflicting min-height/padding that skew alignment.
3. Bind graph SVG height to `commits.length * ROW_HEIGHT`.
4. If using sticky graph overlay, verify scroll container is the list parent (not page body) so graph and rows move together.
5. On panel resize (`ResizeObserver` or container query), verify graph clip width does not clip dots when lane count increases.
6. Add a comment in `GitHistoryPanel` documenting alignment strategy for future virtualized lists (virtualization itself is out of scope).

## Acceptance checklist

- [ ] Scrolling 100+ commits keeps dots centered on their rows (manual check).
- [ ] Resizing VC split pane does not desync graph and list.
- [ ] Row height constant imported from one module (no magic numbers duplicated).
- [ ] No horizontal scroll jitter when graph lane count ≤ 8.

## Dependencies

- [d-01-04-integrate-graph-into-history-panel.md](./d-01-04-integrate-graph-into-history-panel.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
