# Phase 2 Execution Plan — Read-Only Git UI

**Spec:** [version-control-idea.md](./version-control-idea.md) §8 phase 2  
**Prior:** [phase-1-execution-plan.md](./phase-1-execution-plan.md)  
**Next:** [phase-3-execution-plan.md](./phase-3-execution-plan.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

## Assumptions

- Phase 1 complete: VC view shell with sections and valid-repo gating.
- Phase 0 parsers/fixtures started; extended in this phase.
- History is **current branch only**, flat list (no graph).
- Commit detail = metadata + file list, no diff content.

## Confidence and Risks

Confidence: **Medium** (parsing git output is the main risk).

Residual uncertainties:

1. Porcelain v2 vs v1 for status — pick one for phase 2 (status preview in header) vs defer full status to phase 3.
2. Log limit for MVP (e.g. 500 commits) — apply default cap to avoid huge buffers.
3. Author/date timezone display — use locale formatting consistent with app.

## Agent Level Legend

- `easy` / `medium` / `heavy` — see phase 0 plan.

## Changelog Instructions

- Mark tasks DONE in this file; update `specs/changelog.md`.

## Task Breakdown

#### Task 2.1: Current branch + upstream query (G2-1) [Score:6] [Agent:medium] [~0.5d] [DONE]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §6 queries
2. `gitService.ts`, reference [`QueryCurrentBranch.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryCurrentBranch.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryCurrentBranch.cs)

- Add `queryCurrentBranch(repoRoot)` → `{ name, isDetached, upstream | null }`.
- Add `queryAheadBehind(repoRoot)` when upstream exists.
- Wire to VC header toolbar (read-only labels).

**Acceptance checklist**

- Header shows branch name; detached HEAD labeled.
- Ahead/behind counts when tracking branch set; hidden or “no upstream” otherwise.
- Unit tests for parser helpers.

Dependencies: Phase 1 exit criteria.

---

#### Task 2.2: Commit log query + parser (G2-2) [Score:8] [Agent:medium] [~1d] [DONE]

**Required context**

1. Reference [`QueryCommits.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryCommits.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryCommits.cs) — `--format=%H%x00%P%x00%D%x00…`
2. `app/src/lib/git/fixtures/` from phase 0

- Implement `queryCommits(repoRoot, { limit })` using structured `git log` format (NUL-separated fields).
- Parse decorators for branch/tag refs on commits.
- Default limit 500 (config constant).

**Acceptance checklist**

- Parser tests pass against fixtures + at least one integration-style test with temp repo.
- Returns ordered commits newest-first.

Dependencies: Task 2.1.

---

#### Task 2.3: History panel UI (G2-3) [Score:7] [Agent:medium] [~1d]

**Required context**

1. Task 2.2
2. `VersionControlView.svelte` History section

- Build `GitHistoryPanel.svelte`: scrollable commit list (subject, short SHA, author, relative date).
- Show ref badges (branch/tag) when present.
- Loading + error states; empty repo (no commits yet).

**Acceptance checklist**

- Commits render for current branch only.
- Selecting a row loads detail (Task 2.4).

Dependencies: Task 2.2.

---

#### Task 2.4: Commit detail — metadata + files (G2-4) [Score:7] [Agent:medium] [~1d]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §3 #14
2. `git show --name-status --format=`

- Add `queryCommitDetail(repoRoot, sha)` → full message, author/committer dates, parent SHAs, files with status letters.
- Build detail pane beside or below list (responsive split).

**Acceptance checklist**

- File list shows A/M/D/R paths from `name-status`.
- No diff hunks rendered (backlog D-02).

Dependencies: Task 2.3.

---

#### Task 2.5: Branch list query + parser (G2-5) [Score:6] [Agent:medium] [~0.5d]

**Required context**

1. Reference [`QueryBranches.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryBranches.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryBranches.cs)
2. `git branch -vv` fixture

- Implement `queryBranches(repoRoot)` → local branches with current marker, upstream, last commit hint.

**Acceptance checklist**

- Parser tests pass on fixture stdout.
- Current branch flagged in parsed model.

Dependencies: Task 2.1.

---

#### Task 2.6: Branches panel UI (read-only) (G2-6) [Score:5] [Agent:easy] [~0.5d]

**Required context**

1. Task 2.5
2. Branches section in VC view

- Build `GitBranchesPanel.svelte`: list branches; highlight current.
- Checkout/create buttons visible but disabled (wired in phase 3) OR hidden with “Phase 3” — prefer disabled with tooltip.

**Acceptance checklist**

- Branch list matches `git branch -vv` for sample repo.

Dependencies: Task 2.5.

---

#### Task 2.7: Tag list query + UI (G2-7) [Score:5] [Agent:easy] [~0.5d]

**Required context**

1. Reference [`QueryTags.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryTags.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryTags.cs)
2. Tags section

- Implement `queryTags(repoRoot)` via `git tag -l` (+ optional lightweight metadata).
- Build `GitTagsPanel.svelte` list (read-only; create/delete disabled until phase 3).

**Acceptance checklist**

- Tags sorted alphabetically.
- Empty state when no tags.

Dependencies: Task 2.1.

---

#### Task 2.8: Refresh orchestration (G2-8) [Score:6] [Agent:medium] [~0.5d]

**Required context**

1. All phase 2 panels
2. [version-control-idea.md](./version-control-idea.md) — §5.3

- Add **Refresh** toolbar button calling parallel re-fetch of branch header + active section data.
- Debounce rapid clicks; show loading indicator on header.
- Re-run repo probe on refresh (handles external git ops).

**Acceptance checklist**

- Refresh updates commit list after external `git commit` in terminal.
- Errors surface per-panel without crashing whole view.

Dependencies: Tasks 2.3, 2.6, 2.7.

---

## Dependency graph

```text
Task 2.1 → Task 2.2 → Task 2.3 → Task 2.4
       → Task 2.5 → Task 2.6
       → Task 2.7
Tasks 2.3, 2.6, 2.7 → Task 2.8
```

## Phase 2 exit criteria

- [ ] History, Branches, Tags sections show live git data for current branch context.
- [ ] Commit detail shows file list without diffs.
- [ ] Refresh reloads read-only state.
- [ ] Parser unit tests cover log, branch, tag fixtures.

**Estimate:** ~4.5–5.5 days
