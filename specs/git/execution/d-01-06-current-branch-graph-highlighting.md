# D-01 Task 6 — Current-branch graph highlighting

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-01](../backlog.md)  
**Prior task:** [d-01-05-graph-scroll-sync-and-sizing.md](./d-01-05-graph-scroll-sync-and-sizing.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 6 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Dim non-current-branch lanes and emphasize commits reachable from `HEAD` on the current branch, matching typical git graph UX (simplified subset of reference highlighting modes).

## Required context

1. `buildCommitGraphLayout` and `GitCommitGraphColumn`
2. `queryCurrentBranch` / commit decorators in `gitService.ts`
3. Reference highlighting enum: [`CommitGraphHighlighting`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Models/CommitGraph.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Models/CommitGraph.cs)
4. Reference menu toggles: [`Repository.axaml.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/Repository.axaml.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/Repository.axaml.cs) — graph highlighting modes

## Implementation steps

1. Extend `buildCommitGraphLayout` options with `highlightedShas?: Set<string>`.
2. Add `computeCurrentBranchCommitSet(commits, headSha): Set<string>` — walk first-parent chain from HEAD within loaded commit window (matches current-branch-only history scope).
3. Mark graph primitives `isHighlighted` when both endpoints belong to highlighted set (mirror reference gray pen for non-highlighted links in `CommitGraph.cs` Views).
4. In `GitHistoryPanel`, pass head SHA from first commit row or from `queryCurrentBranch` result already available in parent header — prefer reusing branch query from `VersionControlView` if threaded; otherwise derive from commits[0] when on current branch.
5. Render non-highlighted lanes/curves at ~40% opacity; highlighted at full opacity.
6. **Out of scope:** filter modes dropdown (all branches / selected only) — note in code comment for backlog D-10.

## Acceptance checklist

- [ ] On a repo with merged feature branch, main-line commits are bright; side-branch commits/lanes dimmed.
- [ ] After checkout (phase 3), refresh updates highlighting set.
- [ ] Detached HEAD still highlights reachable set from current HEAD.
- [ ] Unit test: `computeCurrentBranchCommitSet` on merge fixture.

## Dependencies

- [d-01-05-graph-scroll-sync-and-sizing.md](./d-01-05-graph-scroll-sync-and-sizing.md)

## D-01 exit criteria

- [ ] History shows graph column with lanes, merges, scroll alignment, and branch highlighting.
- [ ] All D-01 tasks marked `[DONE]` in filenames/titles.

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
