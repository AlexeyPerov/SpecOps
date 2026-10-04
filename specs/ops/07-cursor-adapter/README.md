# 07 — Cursor native adapter after feasibility

**Updated:** 2026-10-04

**Status:** A source SDK/profile bootstrap verified; authenticated/installed and B–D acceptance open.

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Archived audit](../done/reviews/audit-2026-10-04.md) · [Completed implementation records](../done/README.md)

Cursor follows initial integrations. Verify current SDK/auth/native assets/history/policy before promising capabilities.

## Decisions

- Pin tested official local SDK; no HTTP model wrapper or prompt-based policy emulation.
- Verify supported API-key/browser auth, native storage/Node/assets and bundling.
- No standalone Cloud context; cloud execution remains out of scope.

## Active scope

| Phase | Plan | State |
| --- | --- | --- |
| AS07-A | [Feasibility, SDK/assets and auth](execution-plan-phase-a-sdk-auth.md) | Source verified; authenticated/installed gates open |
| AS07-B | [Durable native agents/runs](execution-plan-phase-b-agent-events.md) | Planned |
| AS07-C | [Native capabilities/cloud boundary](execution-plan-phase-c-capabilities-cloud.md) | Planned |
| AS07-D | [Installed native acceptance](execution-plan-phase-d-hardening-exit.md) | Planned |

## Dependencies and delivery

Technical prerequisites: 02-D and shared profile/contract/03-A/B infrastructure, with lessons from enabled adapters. Default order is after stage 06; handoff is not a technical prerequisite. 07-A → B → C → D; extend release/handoff matrices only for advertised scope.

## Definition of done

- [ ] A–D native feasibility/capability/auth/installed-asset evidence accepted.
- [ ] Profile/history/fault/security behavior matches advertised capabilities.
- [ ] Healthy prior runtimes remain usable; selected-scope 08-A release evidence recorded.
- [ ] Setup/support limitations, accepted evidence and changelog updated when implementation lands.

No persisted-data migrations or compatibility shims. Planned prerequisites are gates, not claims of completed work. Archival of earlier implementation does not close reopened acceptance.

## Current evidence

[AS07-A native feasibility ledger](implementation-notes-phase-a.md): exact official local SDK 1.0.35, isolated API-key/native catalog source and copied account-free durable JSONL/Node/native assets verified on Darwin arm64. Native turns, interactive/browser integration and Cloud execution are not advertised by this bootstrap. [Expanded release baseline](../08-release-gates/baseline-07-a.md) remains blocked; B/C/D and authenticated/signed installed/platform/distribution acceptance remain open.
