# 06 — Execution plan index: Handoff and later native extensions

**Updated:** 2026-10-04

**Status:** Planned

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

Default order is after Claude baseline. A technically needs at least two accepted native runtime baselines plus 03-A/B; B needs OpenCode 04-C; C needs Codex 02-D. These are independent phase prerequisites, not an A → B → C chain. Rerun 08-A when a feature is advertised.

| Phase | Plan | Effort |
| --- | --- | --- |
| A | [Reviewable handoff and lineage](execution-plan-phase-a-handoff.md) | L |
| B | [OpenCode native extensions](execution-plan-phase-b-opencode-extensions.md) | L |
| C | [Simultaneous Codex profiles](execution-plan-phase-c-codex-profiles.md) | L |

## Acceptance

- Each advertised feature has native/config/profile/security evidence.
- Enabled ordered handoff pairs and retry/prompt lineage accepted for A.
- Retained-feature ledger accepted for B; unsupported actions remain unavailable.
- Two-account concurrency/history/logout isolation accepted for C.

## Task tracking

Task prefix is `AS06-<phase>-<NN>`. Numeric folders reflect the default delivery sequence; cross-stage gates and later/recurring work are explicit above. Mark only implemented and verified tasks `[DONE]`, record pinned contracts and actual smoke/support scope, and update `specs/changelog.md`. Completed records live in [done](../done/README.md); open acceptance remains active.
