# Phase 4 Execution Plan — Hardening & Verification

**Spec:** [version-control-idea.md](./version-control-idea.md) §8 phase 4  
**Prior:** [phase-3-execution-plan.md](./phase-3-execution-plan.md)  
**Backlog:** [backlog.md](./backlog.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

## Assumptions

- Phases 0–3 feature-complete for MVP scope.
- macOS + Windows manual verification required before calling MVP done.
- Linux issues filed to backlog, not blockers.

## Confidence and Risks

Confidence: **Medium** (edge cases and cross-platform paths).

Residual uncertainties:

1. Mapping open documents to repo-relative paths for unsaved guard may need normalization helpers from `workspacePaths.ts`.
2. Bare repo detection — read-only mode may need disabling mutation buttons globally.

## Agent Level Legend

- `easy` / `medium` / `heavy` — see phase 0 plan.

## Changelog Instructions

- Mark tasks DONE in this file; update `specs/changelog.md`.

## Task Breakdown

#### Task 4.1: Unsaved editor document guard (G4-1) [Score:8] [Agent:medium] [~1d]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §3 #12, §5.4
2. `documentHelpers.ts`, workspace dirty document enumeration

- Add `assertNoUnsavedDocuments(workspaceContext)` helper used before checkout, pull, and any op that changes HEAD/worktree.
- Dialog: “N unsaved files” — Cancel only (no auto-save).
- Wire into phase 3 mutation entry points.

**Acceptance checklist**

- Checkout blocked when editor has dirty buffer even if git tree clean.
- Guard scoped to active workspace only.

Dependencies: Phase 3 exit criteria.

---

#### Task 4.2: Bare repo + detached HEAD UX (G4-2) [Score:5] [Agent:medium] [~0.5d]

**Required context**

1. Reference [`IsBareRepository.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/IsBareRepository.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/IsBareRepository.cs)
2. [version-control-idea.md](./version-control-idea.md) — §4.4

- Detect bare repo; show read-only banner; disable write actions.
- Detached HEAD: show persistent banner in header; allow read; checkout branch still works when clean.

**Acceptance checklist**

- Bare repo cannot stage/commit.
- Detached state visible to user.

Dependencies: Phase 3.

---

#### Task 4.3: Network and git error surfacing (G4-3) [Score:5] [Agent:easy] [~0.5d]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §3 #10
2. App notify / console patterns

- Standardize `GitCommandError` UI: toast + expandable stderr in console.
- Map common cases: auth failed, no upstream, merge conflict, not a git command.

**Acceptance checklist**

- Push/pull/fetch failures show human-readable primary message + stderr in console.
- No silent failures.

Dependencies: Phase 3.

---

#### Task 4.4: Cross-platform path display (G4-4) [Score:6] [Agent:medium] [~1d]

**Required context**

1. Windows vs macOS path separators in git output
2. Changes panel, history file lists

- Normalize repo-relative paths for display (forward slashes) while preserving correct args for `git add`.
- Verify temp commit message file paths on Windows (Rust).

**Acceptance checklist**

- Manual test on Windows: stage file in nested folder, commit, push.
- Paths in UI don’t show broken `\\` mixes.

Dependencies: Phase 3.

---

#### Task 4.5: Long-running operation UX (G4-5) [Score:4] [Agent:easy] [~0.5d]

**Required context**

1. Reference long-running op UX (backlog only): [`PopupRunningStatus.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/PopupRunningStatus.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/PopupRunningStatus.axaml)
2. Fetch/pull/push buttons

- Disable toolbar buttons while command in flight.
- Optional: cancel not required for MVP — document as backlog if git process hang.

**Acceptance checklist**

- Double-click Push doesn’t spawn parallel pushes.
- Spinner clears on completion/error.

Dependencies: Phase 3.

---

#### Task 4.6: Integration tests + fixture repos (G4-6) [Score:8] [Agent:heavy] [~1d]

**Required context**

1. Phase 0–3 modules
2. Vitest patterns in `app/src/lib/services/*.test.ts`

- Add temp-repo harness: init repo, commit file, assert log parser + status round-trip.
- Rust integration test: `run_git status` in temp dir.
- Document skipped tests when git not installed in CI.

**Acceptance checklist**

- `npm test` green locally with git installed.
- CI strategy documented (skip vs require git).

Dependencies: Phases 0–3.

---

#### Task 4.7: Manual test checklist + MVP sign-off (G4-7) [Score:5] [Agent:easy] [~0.5d]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §7.1 functional requirements
2. All phase plans marked DONE

- Add `specs/git/manual-test-checklist.md` (or section in idea doc) covering macOS + Windows flows.
- Walk checklist; fix critical bugs found.
- Verify §7.1 checkboxes satisfied.

**Acceptance checklist**

- Checklist covers: init, history, branch switch/create, stage/commit, fetch/pull/push, tag create/delete, empty states, dirty guards.
- MVP sign-off note in changelog.

Dependencies: Tasks 4.1–4.6.

---

#### Task 4.8: OpenCode isolation audit (G4-8) [Score:4] [Agent:easy] [~0.5d]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §3.1, §7.2
2. `app/src/lib/git/**`, `VersionControl*.svelte`

- Repo grep: no imports from `workspaceAgentBackend`, `fileStatusTracker`, `opencode*` in git module.
- Confirm VC works with OpenCode disabled in settings.

**Acceptance checklist**

- `grep -r opencode app/src/lib/git` empty.
- VC tab functions with OpenCode off.

Dependencies: Phase 3.

---

## Dependency graph

```text
Phase 3 → Task 4.1, 4.2, 4.3, 4.4, 4.5, 4.8
Tasks 4.1–4.5, 4.8 → Task 4.6 → Task 4.7
```

## Phase 4 exit criteria

- [ ] All [version-control-idea.md](./version-control-idea.md) §7.1 requirements checked.
- [ ] macOS + Windows manual checklist passed.
- [ ] OpenCode isolation verified.
- [ ] `npm test` / `npm run check` pass.

**Estimate:** ~4.5–5 days

## Full MVP total

| Phase | Estimate |
|---|---|
| 0 | ~3.5–4 d |
| 1 | ~2.5–3 d |
| 2 | ~4.5–5.5 d |
| 3 | ~7–8 d |
| 4 | ~4.5–5 d |
| **Total** | **~22–25.5 days (~4.5–5 weeks)** |
