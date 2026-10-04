# 06 — Handoff and later native extensions

**Updated:** 2026-10-04

**Status:** Planned

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Archived audit](../done/reviews/audit-2026-10-04.md) · [Completed implementation records](../done/README.md)

Group later work without blocking initial native baselines: handoff, retained OpenCode features and simultaneous Codex profiles inside SpecOps.

## Decisions

- Handoff creates a new target-native session from user-reviewed context; source remains unchanged.
- OpenCode extensions use host capability interfaces; never revive legacy frontend/supervisor.
- Multiple Codex profiles use independent native home/auth/process; no automatic quota rotation or history transfer.

## Active scope

| Phase | Plan | State |
| --- | --- | --- |
| AS06-A | [Reviewable handoff and lineage](execution-plan-phase-a-handoff.md) | Planned |
| AS06-B | [OpenCode native extensions](execution-plan-phase-b-opencode-extensions.md) | Planned |
| AS06-C | [Simultaneous Codex profiles](execution-plan-phase-c-codex-profiles.md) | Planned |

## Dependencies and delivery

Default order is after Claude baseline. A technically needs at least two accepted native runtime baselines plus 03-A/B; B needs OpenCode 04-C; C needs Codex 02-D. These are independent phase prerequisites, not an A → B → C chain. Rerun 08-A when a feature is advertised.

## Definition of done

- [ ] Each advertised feature has native/config/profile/security evidence.
- [ ] Enabled ordered handoff pairs and retry/prompt lineage accepted for A.
- [ ] Retained-feature ledger accepted for B; unsupported actions remain unavailable.
- [ ] Two-account concurrency/history/logout isolation accepted for C.
- [ ] Setup/support limitations, accepted evidence and changelog updated when implementation lands.

No persisted-data migrations or compatibility shims. Planned prerequisites are gates, not claims of completed work. Archival of earlier implementation does not close reopened acceptance.
