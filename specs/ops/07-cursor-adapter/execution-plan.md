# 07 — Execution plan index: Cursor native adapter after feasibility

**Updated:** 2026-10-04

**Status:** Planned

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

Technical prerequisites: 02-D and shared profile/contract/03-A/B infrastructure, with lessons from enabled adapters. Default order is after stage 06; handoff is not a technical prerequisite. 07-A → B → C → D; extend release/handoff matrices only for advertised scope.

| Phase | Plan | Effort |
| --- | --- | --- |
| A | [Feasibility, SDK/assets and auth](execution-plan-phase-a-sdk-auth.md) | M/L |
| B | [Durable native agents/runs](execution-plan-phase-b-agent-events.md) | L |
| C | [Native capabilities/cloud boundary](execution-plan-phase-c-capabilities-cloud.md) | M/L |
| D | [Installed native acceptance](execution-plan-phase-d-hardening-exit.md) | M/L |

## Acceptance

- A–D native feasibility/capability/auth/installed-asset evidence accepted.
- Profile/history/fault/security behavior matches advertised capabilities.
- Healthy prior runtimes remain usable; selected-scope 08-A release evidence recorded.

## Task tracking

Task prefix is `AS07-<phase>-<NN>`. Numeric folders reflect the default delivery sequence; cross-stage gates and later/recurring work are explicit above. Mark only implemented and verified tasks `[DONE]`, record pinned contracts and actual smoke/support scope, and update `specs/changelog.md`. Completed records live in [done](../done/README.md); open acceptance remains active.
