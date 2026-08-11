# 06 — Handoff, shared-workspace observability, and release polish

**Status:** Planned  
**Date:** 2026-08-11  
**Main doc (SSOT):** [`../roadmap.md`](../roadmap.md)  
**Execution plan:** [`execution-plan.md`](execution-plan.md)  
**Phase plans:** [A](execution-plan-phase-a-handoff.md), [B](execution-plan-phase-b-observability.md), [C](execution-plan-phase-c-packaging-diagnostics.md), [D](execution-plan-phase-d-release-exit.md)

This milestone completes the cross-runtime workflow and makes permissive
shared-workspace execution understandable, diagnosable, and releasable.

## Locked decisions (2026-08-11)

| # | Topic | Choice |
| - | ----- | ------ |
| 1 | Handoff | New target-native session seeded by a user-reviewed context packet |
| 2 | Concurrency | Warn and observe; never lock, isolate, or serialize writers |
| 3 | Recovery | Stop does not roll back files; git recovery remains user-owned |
| 4 | Distribution | Bundle/install runtimes only where licensing permits; support PATH overrides |
| 5 | Diagnostics | Support bundles are redacted and runtime health is independent |

## Goal

Users can hand work between enabled runtimes and safely understand concurrent
activity, while release builds supervise every process and provide actionable,
secret-safe recovery information.

## Scope

| ID | Item | Current state |
| --- | ---- | ------------- |
| AS06-A | Reviewable cross-runtime handoff and lineage | Missing |
| AS06-B | Running/writer visibility, warnings and overlap signals | Missing |
| AS06-C | Packaging, health, diagnostics and recovery UX | Partial |
| AS06-D | Platform matrix, security, docs and release exit | Missing |

## Outcome

- Every enabled runtime pair can create a traceable handoff session.
- Concurrent writers remain allowed and visibly risky.
- Release builds leave no orphan processes and produce secret-safe diagnostics.

## Dependencies

- **Phases 01–05** — Done for every runtime included in release.

**Blocks:** production release of the multi-runtime Sessions product.

## Out of scope

- Native history transfer or native-id reuse across vendors.
- Automatic worktrees, locks, branches, commits, stashes, rollback, or merging.
- A general-purpose third-party agent platform.

## Risks

- **Sensitive handoff content** — default-exclude raw tool output and require
  review before the first target prompt.
- **Platform-specific process behavior** — require launch-to-shutdown smoke on
  every supported target.

## Definition of done

- All phase plans A–D and the supported-platform matrix pass.
- User-facing auth, capability, risk, handoff, diagnostics, and recovery docs ship.
- Status is changed to Done here and in [`../roadmap.md`](../roadmap.md).

### Definition of done — docs

- [ ] Runtime support/capability table finalized.
- [ ] Shared-workspace risk and recovery guide finalized.
- [ ] Changelog entry appended in [`../../changelog.md`](../../changelog.md).
- [ ] Release exit manually reviewed.
