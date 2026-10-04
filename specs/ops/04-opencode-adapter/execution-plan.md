# 04 — Execution plan index: core cutover before extensions

**Date:** 2026-10-04

**Status:** Planned

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

03-D → A → B → D; **D does not require C**. C follows accepted D at default slot 6. Early 06-B/C runtime-specific extensions are accepted by D; no prerequisite implementation of Claude.

| Phase | Plan | Effort | Delivery gate |
| --- | --- | --- | --- |
| A | [Ownership and finite parity ledger](execution-plan-phase-a-host-lifecycle.md) | L | Second-runtime baseline |
| B | [Core session/event parity](execution-plan-phase-b-core-parity.md) | L | Second-runtime baseline |
| D | [Core cutover and acceptance](execution-plan-phase-d-cutover-exit.md) | L | Second-runtime baseline |
| C | [Later optional native extensions](execution-plan-phase-c-extensions-ui.md) | L | Later native depth |

## Delivery policy

Freeze finite core/parity ledger in A. Keep legacy only as temporary reference, never double-own child processes; remove direct path in D even if rich features are explicitly deferred. Baseline Done and full milestone Done are different statuses.

## Exit verification

- Codex/OpenCode core and profile-bound restart parity.
- Exactly one native runtime owner; no frontend SDK after D.
- Required/retained/deferred ledger is complete before cutover.
- Installed/native/security and subset-release evidence, later extension gate separate.

## Task tracking

Use `AS04-<phase>-<NN>` for task IDs. Folder prefixes are stable milestone identities, not delivery order. Planned dependencies are conditions to satisfy, not claims that upstream work is Done. Keep scope bounded by task acceptance; record fixtures, version/support scope and residual gaps. Mark only implemented and verified tasks `[DONE]` and log changes in `specs/changelog.md`.
