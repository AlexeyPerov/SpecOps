# 04 — OpenCode core cutover

**Updated:** 2026-10-04

**Status:** Planned

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Archived audit](../done/reviews/audit-2026-10-04.md) · [Completed implementation records](../done/README.md)

OpenCode is the second native runtime. Existing code/fixtures are input, not proof of new-host readiness. Core A–C ships before rich extensions in 06-B.

## Decisions

- Inventory required/retained/deferred legacy features in A; finite core gate.
- Exactly one native runtime owner in every intermediate state.
- Remove legacy frontend SDK/supervisor at C; profile credentials and native details remain host-side.

## Active scope

| Phase | Plan | State |
| --- | --- | --- |
| AS04-A | [Ownership and finite parity ledger](execution-plan-phase-a-host-lifecycle.md) | Planned |
| AS04-B | [Core session/event parity](execution-plan-phase-b-core-parity.md) | Planned |
| AS04-C | [Core cutover and acceptance](execution-plan-phase-c-cutover-exit.md) | Planned |

## Dependencies and delivery

02-D → 04-A → 04-B → 04-C. Extend 03-A/B for this runtime before C acceptance. Accepted C unblocks scheduled Claude 05 and permits later handoff. Optional extensions 06-B do not gate core cutover.

## Definition of done

- [ ] A/B/C core parity, profile/history and Codex coexistence accepted.
- [ ] No direct vendor SDK in WebView or legacy competing runtime owner.
- [ ] Every rich feature is explicitly retained/deferred with owner; implement retained features later in 06-B.
- [ ] Installed/core security and selected-scope 08-A evidence recorded.
- [ ] Setup/support limitations, accepted evidence and changelog updated when implementation lands.

No persisted-data migrations or compatibility shims. Planned prerequisites are gates, not claims of completed work. Archival of earlier implementation does not close reopened acceptance.
