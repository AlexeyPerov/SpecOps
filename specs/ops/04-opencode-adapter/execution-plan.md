# 04 — Execution plan index: OpenCode core cutover

**Updated:** 2026-10-04

**Status:** Planned

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

02-D → 04-A → 04-B → 04-C. Extend 03-A/B for this runtime before C acceptance. Accepted C unblocks scheduled Claude 05 and permits later handoff. Optional extensions 06-B do not gate core cutover.

| Phase | Plan | Effort |
| --- | --- | --- |
| A | [Ownership and finite parity ledger](execution-plan-phase-a-host-lifecycle.md) | L |
| B | [Core session/event parity](execution-plan-phase-b-core-parity.md) | L |
| C | [Core cutover and acceptance](execution-plan-phase-c-cutover-exit.md) | L |

## Acceptance

- A/B/C core parity, profile/history and Codex coexistence accepted.
- No direct vendor SDK in WebView or legacy competing runtime owner.
- Every rich feature is explicitly retained/deferred with owner; implement retained features later in 06-B.
- Installed/core security and selected-scope 08-A evidence recorded.

## Task tracking

Task prefix is `AS04-<phase>-<NN>`. Numeric folders reflect the default delivery sequence; cross-stage gates and later/recurring work are explicit above. Mark only implemented and verified tasks `[DONE]`, record pinned contracts and actual smoke/support scope, and update `specs/changelog.md`. Completed records live in [done](../done/README.md); open acceptance remains active.
