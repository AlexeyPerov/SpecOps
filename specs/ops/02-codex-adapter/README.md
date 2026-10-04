# 02 — Codex native harness and isolated account

**Updated:** 2026-10-04

**Status:** In progress — A/B implemented from source; experimental developer/live account acceptance pending

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
| AS02-C | [Native config, limits and reconciliation](execution-plan-phase-c-capabilities-history.md) | Planned |
| AS02-D | [Installed account-B acceptance](execution-plan-phase-d-hardening-exit.md) | Planned |

**Phase A evidence:** [Implementation and support ledger](implementation-notes-phase-a.md). Automated profile/protocol/bootstrap checks pass; no live account-B login is claimed.

## Dependencies and delivery

01-S → 02-A → 02-B → 02-C. 02-B feeds independent 03-A/03-B. 02-C + 03-A/03-B → 02-D; selected-scope 08-A then decides release. No Claude prerequisite.

## Definition of done

- [ ] A–D task/contract/security and desktop-A/SpecOps-B smoke accepted.
- [ ] Installed activity/packaging gates 03-A/B accepted outside checkout/developer PATH.
- [ ] Native feature/auth/config/history/recovery ledger and selected-scope 08-A evidence recorded.
- [ ] Setup/support limitations, accepted evidence and changelog updated when implementation lands.

No persisted-data migrations or compatibility shims. Planned prerequisites are gates, not claims of completed work. Archival of earlier implementation does not close reopened acceptance.

**Phase B evidence:** [Native coding implementation and pin/support ledger](implementation-notes-phase-b.md). Official 0.160.0 distribution requires explicit persisted profile experimental opt-in and legacy history for coding/resume; default coding creation fails before work. Native/shared/production/UI fixtures pass; real authenticated coding, whole-host recovery and installed acceptance remain open.
