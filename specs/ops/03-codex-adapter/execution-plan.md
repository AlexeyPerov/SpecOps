# 03 — Execution plan index: Codex-first delivery

**Date:** 2026-10-04

**Status:** Planned

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

01-S → A → B → C → D. D additionally requires early 06-B/C; neither early phase depends on D or handoff. E follows accepted D at delivery slot 6 and is excluded from first-preview gate.

| Phase | Plan | Effort | Delivery gate |
| --- | --- | --- | --- |
| A | [Isolated profile and authentication](execution-plan-phase-a-protocol-auth.md) | M/L | Baseline prerequisite |
| B | [Native coding slice and minimum resume](execution-plan-phase-b-thread-events.md) | L | Developer slice |
| C | [Native config, limits and reconciliation](execution-plan-phase-c-capabilities-history.md) | M/L | Baseline prerequisite |
| D | [Installed account-B acceptance](execution-plan-phase-d-hardening-exit.md) | M/L | Installed preview gate |
| E | [Multiple simultaneous SpecOps profiles](execution-plan-phase-e-multi-profile.md) | L | Later optional extension |

## Delivery policy

Read official pinned protocol/auth/config and the audit. Add profile identity consistently to domain, host, client, persistence and control-plane events. Keep existing AS03-A–D task IDs; audit proposal labels AS03-P/M/R map to A/B/C–D. No native protocol negotiation assumption or live secrets in default tests.

## Exit verification

- Desktop-A/SpecOps-B isolation, profile identity, production persistence and same-thread restart.
- Tools/approvals/questions where supported, bounded cancel/failure and truthful catalogs/config.
- Native/cache reconciliation, profile limits and safe diagnostics.
- Installed macOS build works outside checkout; first preview does not wait for E or any other vendor.

## Task tracking

Use `AS03-<phase>-<NN>` for task IDs. Folder prefixes are stable milestone identities, not delivery order. Planned dependencies are conditions to satisfy, not claims that upstream work is Done. Keep scope bounded by task acceptance; record fixtures, version/support scope and residual gaps. Mark only implemented and verified tasks `[DONE]` and log changes in `specs/changelog.md`.
