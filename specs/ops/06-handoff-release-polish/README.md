# 06 — Shared activity, packaging, handoff and release gates

**Date:** 2026-10-04

**Status:** Planned

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Implementation audit](../audit-2026-10-04.md)

Shared work is split by actual dependencies: B/C before usable Codex; A after two accepted native runtimes; D runs for every selected-scope release and only closes finally when roadmap scope is complete.

## Decisions

- B/C are independent of handoff and later vendor adapters.
- Shared cwd execution warns/observes; no locks, isolation, serialization or automatic git recovery.
- Bundle host and compatible Node; vendor executable may be explicitly user-managed if distribution requires.
- Handoff requires reviewed content, new target-native session and selected target profile.
- Support exports are bounded/allowlisted and omit auth/native homes/raw tool output by default.

## Scope and current state

| Phase | Work | State |
| --- | --- | --- |
| AS06-B | [Early workspace activity](execution-plan-phase-b-observability.md) | Missing |
| AS06-C | [Early installed build/diagnostics](execution-plan-phase-c-packaging-diagnostics.md) | Partial infrastructure; acceptance missing |
| AS06-A | [Later reviewable handoff](execution-plan-phase-a-handoff.md) | Missing |
| AS06-D | [Subset release matrix and final closure](execution-plan-phase-d-release-exit.md) | Missing |

## Dependencies and delivery

S enables packaging preparation; 03-B enables B and C runtime acceptance. B/C + 03-C → 03-D; first selected-scope D follows Codex D. A requires at least two accepted baselines and defaults to slot 6. D later covers only features selected for each release; final closure requires full active roadmap.

## Expected outcomes

- First installed Codex preview has writer visibility, useful safe diagnostics and recovery.
- Every advertised handoff pair/profile is tested when shipped.
- Supported platform scope is evidence-backed and native children are reaped.

## Out of scope

- Data migrations, credential/thread portability, automatic account rotation.
- Automatic worktrees, locks, branches, commits, stash, rollback or merge.
- A mandatory all-runtime release or standalone Cloud product surface.

## Definition of done

- [ ] B/C accepted for first usable Codex preview and extended for enabled adapters/platforms.
- [ ] A pairwise/review/security gate accepted when handoff ships.
- [ ] Each subset release has D evidence; missing later tasks remain Planned.
- [ ] Full roadmap scope verified before final D/roadmap closure.
- [ ] Setup/auth/profile/limits/native capability/risk/recovery docs and changelog current.
