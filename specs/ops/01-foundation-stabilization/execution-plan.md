# 01 — Execution plan index: Foundation acceptance stabilization

**Updated:** 2026-10-04

**Status:** Planned

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

AS01-S precedes Codex AS02-A. Native profile/creation/catalog gaps belong to 02-A; installed build gaps belong to 03-B. Full foundation acceptance includes those allocated downstream gates, while S alone permits Codex work.

| Phase | Plan | Effort |
| --- | --- | --- |
| S | [Stabilization](execution-plan-phase-s-stabilization.md) | M/L |

## Acceptance

- Production binding survives fresh-store/host restart; no hidden new native session.
- No hung request/turn/quit, secret-bearing error or orphan process on supported targets.
- Remaining Critical/Major review findings have evidence-backed task dispositions.

## Task tracking

Task prefix is `AS01-<phase>-<NN>`. Numeric folders reflect the default delivery sequence; cross-stage gates and later/recurring work are explicit above. Mark only implemented and verified tasks `[DONE]`, record pinned contracts and actual smoke/support scope, and update `specs/changelog.md`. Completed records live in [done](../done/README.md); open acceptance remains active.
