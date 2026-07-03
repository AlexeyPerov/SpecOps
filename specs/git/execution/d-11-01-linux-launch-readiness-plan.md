# D-11 Task 1 — Linux launch readiness plan

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-11](../backlog.md) — Linux as co-equal launch platform  
**Spec:** [version-control-idea.md](../version-control-idea.md) §3 #15  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 6 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Prepare and execute a Linux parity plan for Version Control workflows, covering path handling, process invocation, and UI expectations.

## Required context

1. Existing platform-specific path handling in `app/src-tauri/src/git.rs`
2. Existing test harness and integration suite in `app/src/lib/git/test/*`
3. CI pipeline definitions for current platforms
4. Reference Linux support assumptions from cross-platform command layer: [`Commands/Command.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Command.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Command.cs)
5. Reference OS/runtime settings handling: [`Models/Preferences.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Models/Preferences.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Models/Preferences.cs)

## Implementation steps

1. Add Linux environment matrix to manual checklist (git install path, credential helper behavior, file mode changes).
2. Run and fix VC integration tests under Linux runner; document any platform-specific skips with rationale.
3. Validate key git commands with paths containing spaces/non-ASCII under Linux shell.
4. Ensure busy-state/askpass/fetch-pull-push flows are tested in Linux smoke run.
5. Add changelog and checklist updates capturing parity status and residual gaps.

## Acceptance checklist

- [ ] Linux runner executes git integration suite without unexpected failures.
- [ ] Manual checklist includes Linux-specific verification steps.
- [ ] Any known Linux-only issues are documented with severity and follow-up IDs.
- [ ] No regressions introduced for macOS/Windows pipelines.

## Dependencies

- D-05 and D-06 recommended before full credential/network parity sign-off

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
