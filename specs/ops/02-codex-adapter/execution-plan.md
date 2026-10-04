# 02 — Execution plan index: Codex native harness and isolated account

**Updated:** 2026-10-04

**Status:** In progress — A implemented from source; live account acceptance pending

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

01-S → 02-A → 02-B → 02-C. 02-B feeds independent 03-A/03-B. 02-C + 03-A/03-B → 02-D; selected-scope 08-A then decides release. No Claude prerequisite.

| Phase | Plan | Effort |
| --- | --- | --- |
| A | [Isolated profile and authentication](execution-plan-phase-a-protocol-auth.md) | M/L |
| B | [Native coding slice and minimum resume](execution-plan-phase-b-thread-events.md) | L |
| C | [Native config, limits and reconciliation](execution-plan-phase-c-capabilities-history.md) | M/L |
| D | [Installed account-B acceptance](execution-plan-phase-d-hardening-exit.md) | M/L |

**Phase A evidence:** [Implementation and support ledger](implementation-notes-phase-a.md); automated/bootstrap accepted, manual account-B gate open.

## Acceptance

- A–D task/contract/security and desktop-A/SpecOps-B smoke accepted.
- Installed activity/packaging gates 03-A/B accepted outside checkout/developer PATH.
- Native feature/auth/config/history/recovery ledger and selected-scope 08-A evidence recorded.

## Task tracking

Task prefix is `AS02-<phase>-<NN>`. Numeric folders reflect the default delivery sequence; cross-stage gates and later/recurring work are explicit above. Mark only implemented and verified tasks `[DONE]`, record pinned contracts and actual smoke/support scope, and update `specs/changelog.md`. Completed records live in [done](../done/README.md); open acceptance remains active.
