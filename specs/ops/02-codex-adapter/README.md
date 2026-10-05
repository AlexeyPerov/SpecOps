# 02 — Codex native harness and isolated account

**Updated:** 2026-10-05

**Status:** In progress — A–F source implemented; experimental developer/live account and installed acceptance pending

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Archived audit](../done/reviews/audit-2026-10-04.md) · [Completed implementation records](../done/README.md)

Codex is the first production runtime and the second active milestone. A–D delivers an installed macOS preview with desktop account A and SpecOps account B. Later simultaneous SpecOps profiles are owned by 06-C.

## Decisions

- Pinned app-server owns native loop/tools/history; profile-scoped home/auth/config and routing.
- Persist immutable runtime/profile/native thread; model/effort/collaboration/sandbox/approval are distinct settings.
- Official API-key/browser/device login only where supported; native history wins over cache.

## Active scope

| Phase | Plan | State |
| --- | --- | --- |
| AS02-A | [Isolated profile and authentication](execution-plan-phase-a-protocol-auth.md) | Implemented; manual account gate pending |
| AS02-B | [Native coding slice and minimum resume](execution-plan-phase-b-thread-events.md) | Experimental source/fixtures verified; authenticated developer smoke pending |
| AS02-C | [Native config, limits and reconciliation](execution-plan-phase-c-capabilities-history.md) | Experimental legacy source/fixtures verified; unsupported native surfaces and live acceptance explicit |
| AS02-D | [Installed account-B acceptance](execution-plan-phase-d-hardening-exit.md) | Source hardening verified; installed/account gates blocked |
| AS02-E | [Native session controls](execution-plan-phase-e-native-session-parity.md) | Source/fixtures verified; legacy rollback unavailable; real account/installed gates open |
| AS02-F | [Native ecosystem and profile configuration](execution-plan-phase-f-ecosystem-config-parity.md) | Source/fixtures verified; OAuth/plugins unavailable; real account/installed gates open |

**Phase A evidence:** [Implementation and support ledger](implementation-notes-phase-a.md). Automated profile/protocol/bootstrap checks pass; no live account-B login is claimed.

## Dependencies and delivery

01-S → 02-A → 02-B → 02-C. 02-B feeds independent 03-A/03-B. 02-C + 03-A/03-B → 02-D; selected-scope 08-A then decides release. No Claude prerequisite.

## Definition of done

- [ ] A–D task/contract/security and desktop-A/SpecOps-B smoke accepted.
- [ ] Installed activity/packaging gates 03-A/B accepted outside checkout/developer PATH.
- [x] Native feature/auth/config/history/recovery ledger and selected-scope 08-A evidence recorded (source evidence and blocked release recommendation).
- [x] Setup/support limitations, source evidence and changelog updated; installed acceptance remains open.

No persisted-data migrations or compatibility shims. Planned prerequisites are gates, not claims of completed work. Archival of earlier implementation does not close reopened acceptance.

**Phase B evidence:** [Native coding implementation and pin/support ledger](implementation-notes-phase-b.md). Official 0.160.0 distribution requires explicit persisted profile experimental opt-in and legacy history for coding/resume; default coding creation fails before work. Native/shared/production/UI fixtures pass; real authenticated coding, whole-host recovery and installed acceptance remain open.

**Phase C evidence:** [Configuration, usage/recovery and reconciliation ledger](implementation-notes-phase-c.md). Optional neutral session controls, profile-scoped sparse limits/auth recovery, host/child epoch guards, authoritative materialized-legacy hydration and divergent/corrupt/missing-cache recovery are fixture-verified. The pinned unavailable paginated-items API and native management panels remain explicit deferrals; default coding stays gated and authenticated/installed acceptance stays open.

**Phase D evidence:** [Fault/security closure, setup/recovery and AS08-A selected-scope submission](implementation-notes-phase-d.md). Actual bundled-host death settles two native streams including pending approval; native split-secret masking, bounded accumulated state and observed descendant retirement are source-verified. Immediate orphan race, installed AS03-A/B and human account-A/B smoke remain open; baseline preview and milestone A–D are not Done.

**Phase E:** [Native session controls](execution-plan-phase-e-native-session-parity.md) — verified native fork, compact lifecycle and active-turn steering source; selected legacy conversation rollback explicitly unsupported. [Evidence and finite ledger](implementation-notes-phase-e.md). Ecosystem management is implemented in F; detailed subagent UI is subsequent work. Authenticated/installed acceptance remains open.

**Phase F:** [Native ecosystem and finite configuration](execution-plan-phase-f-ecosystem-config-parity.md) — native skills toggles, bounded MCP inventory, existing profile-server enable/disable with reload and versioned private configuration controls. [Finite support and evidence](implementation-notes-phase-f.md). OAuth/plugin APIs remain unavailable; actual account/installed acceptance stays open.
