# Phase 3 Execution Plan — Git Mutations

**Spec:** [version-control-idea.md](./version-control-idea.md) §8 phase 3  
**Prior:** [phase-2-execution-plan.md](./phase-2-execution-plan.md)  
**Next:** [phase-4-execution-plan.md](./phase-4-execution-plan.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

## Assumptions

- Phase 2 read-only panels and refresh in place.
- Default remote/upstream policy for push/pull (no remote picker UI).
- Local tag delete only.
- Dirty-tree checkout blocked (phase 4 adds unsaved-doc guard; basic git dirty check here).

## Confidence and Risks

Confidence: **Medium** (network ops + staging UX).

Residual uncertainties:

1. `git status` porcelain format choice affects stage/unstage path handling on Windows.
2. Commit message multiline — use temp file via Rust or `-m` for single paragraph MVP.
3. Pull merge conflicts — surface stderr; no merge UI in MVP.

## Agent Level Legend

- `easy` / `medium` / `heavy` — see phase 0 plan.

## Changelog Instructions

- Mark tasks DONE in this file; update `specs/changelog.md`.

## Task Breakdown

#### Task 3.1: Working tree status query (G3-1) [Score:7] [Agent:medium] [~0.5d] [DONE]

**Required context**

1. Reference [`QueryLocalChanges.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryLocalChanges.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryLocalChanges.cs), [`QueryRepositoryStatus.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryRepositoryStatus.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryRepositoryStatus.cs)
2. [version-control-idea.md](./version-control-idea.md) — §6 status

- Implement `queryWorkingTreeStatus(repoRoot)` → staged + unstaged file entries with status codes.
- Parser tests with porcelain fixtures.

**Acceptance checklist**

- Correctly splits staged vs unstaged.
- Handles untracked files (include in unstaged).

Dependencies: Phase 2 exit criteria.

---

#### Task 3.2: Changes panel layout (G3-2) [Score:7] [Agent:medium] [~1d] [DONE]

**Required context**

1. Task 3.1
2. Reference working-copy layout (simplified): [`WorkingCopy.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/WorkingCopy.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/WorkingCopy.axaml)

- Build `GitChangesPanel.svelte`: two lists (Unstaged, Staged) with file paths relative to repo root.
- Row selection (multi-select).
- Commit message textarea + **Commit** button (disabled when nothing staged).

**Acceptance checklist**

- Lists match `git status` after manual file edits.
- Empty states when clean tree.

Dependencies: Task 3.1.

---

#### Task 3.3: Stage and unstage actions (G3-3) [Score:7] [Agent:medium] [~1d] [DONE]

**Required context**

1. Task 3.2
2. `git add --`, `git restore --staged --`

- Wire stage/unstage selected paths; `git add -A` optional toolbar for stage all unstaged (nice-to-have in same task).
- Refresh status + Changes lists after each action.

**Acceptance checklist**

- Stage moves file from unstaged to staged list.
- Unstage reverses.
- Paths with spaces work on Windows + macOS.

Dependencies: Task 3.2.

---

#### Task 3.4: Create commit (G3-4) [Score:7] [Agent:medium] [~1d] [DONE]

**Required context**

1. Reference [`Commit.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Commit.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Commit.cs)
2. Task 3.3

- Implement `createCommit(repoRoot, message)` — prefer commit via temp message file from Rust side or `-F` with secure temp path.
- Validate non-empty message; trim whitespace.
- On success: clear message, refresh status/history/header.

**Acceptance checklist**

- Commit appears at top of history after refresh.
- Empty message blocked in UI with inline error.

Dependencies: Task 3.3.

---

#### Task 3.5: Checkout branch (G3-5) [Score:6] [Agent:medium] [~0.5d] [DONE]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §3 #11
2. Branches panel

- Implement `checkoutBranch(repoRoot, name)`.
- Before checkout: if `git status --porcelain` non-empty → block with dialog (git dirty tree).
- Enable branch row / checkout button in Branches panel.

**Acceptance checklist**

- Switching branch updates header + history list.
- Dirty tree blocks checkout with clear message.

Dependencies: Task 3.1, Phase 2 branches UI.

---

#### Task 3.6: Create branch (G3-6) [Score:5] [Agent:easy] [~0.5d] [DONE]

**Required context**

1. Branches panel
2. `git checkout -b` or `git branch` + checkout

- Modal or inline input for new branch name; validate ref name (basic git rules).
- Create from current HEAD; refresh branch list.

**Acceptance checklist**

- New branch appears and becomes current after create.
- Invalid names rejected before git call.

Dependencies: Task 3.5.

---

#### Task 3.7: Fetch (G3-7) [Score:5] [Agent:easy] [~0.5d]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §3 #8
2. VC toolbar

- Implement `fetch(repoRoot)` → `git fetch`; show progress/spinner on toolbar button.
- Refresh ahead/behind + branches after success.

**Acceptance checklist**

- Fetch updates remote-tracking refs (visible in branch upstream info after refresh).
- Network failure shows stderr in alert/toast.

Dependencies: Phase 2 header.

---

#### Task 3.8: Pull (G3-8) [Score:7] [Agent:medium] [~0.5d]

**Required context**

1. Task 3.7
2. Dirty tree policy — block if porcelain dirty (same as checkout)

- Implement `pull(repoRoot)` → `git pull`.
- Block when working tree dirty; surface merge conflict stderr without merge UI.

**Acceptance checklist**

- Successful pull updates history and cleans fast-forward case.
- Conflict abort message shown to user.

Dependencies: Tasks 3.1, 3.7.

---

#### Task 3.9: Push (G3-9) [Score:6] [Agent:medium] [~0.5d]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §3 #9
2. Default upstream push

- Implement `push(repoRoot)` → `git push` (default remote/upstream).
- Handle no-upstream error with actionable message (“set upstream” → backlog).

**Acceptance checklist**

- Push succeeds when upstream configured.
- Auth failure stderr visible (credential helper).

Dependencies: Task 3.7.

---

#### Task 3.10: Create tag (G3-10) [Score:5] [Agent:easy] [~0.5d]

**Required context**

1. Tags panel
2. `git tag <name>` lightweight tag MVP

- Dialog for tag name; create at HEAD.
- Refresh tag list.

**Acceptance checklist**

- New tag appears in list.
- Duplicate tag name shows git error.

Dependencies: Phase 2 tags UI.

---

#### Task 3.11: Delete local tag (G3-11) [Score:4] [Agent:easy] [~0.5d]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §3 #13
2. Tags panel

- Delete selected tag with confirmation → `git tag -d`.
- Refresh list.

**Acceptance checklist**

- Tag removed locally.
- No remote delete attempted.

Dependencies: Task 3.10.

---

#### Task 3.12: Post-mutation refresh bundle (G3-12) [Score:5] [Agent:easy] [~0.5d]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §5.3
2. All mutation tasks

- Centralize `refreshAfterMutation(scope)` to re-fetch header, active section, and history when needed.
- Log git commands to app console (command + exit code summary).

**Acceptance checklist**

- Commit refreshes history + changes + header.
- No stale UI after push/pull/checkout.

Dependencies: Tasks 3.4–3.11.

---

## Dependency graph

```text
Task 3.1 → Task 3.2 → Task 3.3 → Task 3.4 → Task 3.12
Task 3.1 → Task 3.5 → Task 3.6
Phase 2 header → Task 3.7 → Task 3.8, Task 3.9
Phase 2 tags → Task 3.10 → Task 3.11 → Task 3.12
```

## Phase 3 exit criteria

- [ ] Full MVP mutation set: stage, commit, checkout, create branch, fetch, pull, push, create/delete tag.
- [ ] Changes panel end-to-end commit flow works.
- [ ] Dirty git tree blocks checkout and pull.
- [ ] Toolbar network actions use default upstream.

**Estimate:** ~7–8 days
