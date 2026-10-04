# 01 — Execution plan index: foundation and stabilization

**Date:** 2026-10-04

**Status:** Planned

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

Historical A → B → C → D → E → F records remain below; **only S is the next foundation execution slice**. Execute S-01 → S-02 → S-03 → S-04 → S-05, closing P0 before credentials. Tasks can overlap only when persistence/transport/lifecycle boundaries are agreed.

| Phase | Plan | Effort | Delivery gate |
| --- | --- | --- | --- |
| S | [Stabilization](execution-plan-phase-s-stabilization.md) | M/L | Prerequisite for live account work |

## Delivery policy

Do not use historical Done as acceptance evidence. Active creation/profile/catalog work is 03-A; installed build is 06-C. No branches/PR workflow or persisted-data migrations.

## Exit verification

- Full production binding survives fresh-process restart.
- No hung request/turn/quit or unsafe error path; no orphans on supported targets.
- Negative protocol/contract fixtures verify terminal completion, backpressure and redaction.
- Review ledger has no unowned critical finding.

## Task tracking

Use `AS01-<phase>-<NN>` for task IDs. Folder prefixes are stable milestone identities, not delivery order. Planned dependencies are conditions to satisfy, not claims that upstream work is Done. Keep scope bounded by task acceptance; record fixtures, version/support scope and residual gaps. Mark only implemented and verified tasks `[DONE]` and log changes in `specs/changelog.md`.

## Historical phase records

- [execution-plan-phase-a-chat-removal.md](execution-plan-phase-a-chat-removal.md)
- [execution-plan-phase-b-session-domain.md](execution-plan-phase-b-session-domain.md)
- [execution-plan-phase-c-adapter-contract.md](execution-plan-phase-c-adapter-contract.md)
- [execution-plan-phase-d-agent-host.md](execution-plan-phase-d-agent-host.md)
- [execution-plan-phase-e-supervision.md](execution-plan-phase-e-supervision.md)
- [execution-plan-phase-f-sessions-ux-exit.md](execution-plan-phase-f-sessions-ux-exit.md)
