# 06 — Handoff and later native extensions

**Updated:** 2026-10-04

**Status:** Handoff and selected native extensions source implemented; external acceptance and C remain open

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
| AS06-A | [Reviewable handoff and lineage](execution-plan-phase-a-handoff.md) | Source verified; live/installed pending |
| AS06-B | [OpenCode native extensions](execution-plan-phase-b-opencode-extensions.md) | Source verified; live/installed pending |
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

**AS06-A source evidence:** [Review packet, durable intent and ordered native adapter fixtures](implementation-notes-phase-a.md). Nine fixture pairs and common source regression pass; paid/provider/account and signed installed acceptance remains open. Unix durable storage is mandatory; unsupported platforms fail closed before native creation. [Selected 08-A recommendation](../08-release-gates/baseline-06-a.md) remains blocked.

**AS06-B source evidence:** [Bounded native extensions and explicit exclusions](implementation-notes-phase-b.md), [finite retained ledger](../04-opencode-adapter/cutover-reference-evidence.md) and [blocked selected release baseline](../08-release-gates/baseline-06-b.md). Existing native instructions/configuration remain authoritative; no arbitrary editor, inferred permission guarantee or unowned inference action is advertised.
