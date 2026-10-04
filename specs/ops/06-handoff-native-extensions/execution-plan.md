# 06 — Execution plan index: Handoff and later native extensions

**Updated:** 2026-10-04

**Status:** A/B/C source verified with external gates open

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

## AS06-A source result

[Implementation evidence](implementation-notes-phase-a.md): exact reviewed prompt, fresh native target, immutable profile/policy, neutral lineage and strict before-action intent CAS are implemented. All nine ordered source-adapter fixture pairs pass; real account/provider/installed acceptance is pending. No automatic repeat of an unknown creation or possibly accepted prompt is permitted. B is now selected-source verified; C is independently source verified with actual account/installed acceptance open.

## AS06-B source result

[Native extension source evidence](implementation-notes-phase-b.md) records native lifecycle, finite status/catalog projections, common UI and strict capability/profile/generation/security boundaries. [Retained ledger](../04-opencode-adapter/cutover-reference-evidence.md) explicitly excludes unowned inference/configuration/editor flows. Live and installed acceptance remains open.

## AS06-C source result

[Named profiles and native isolation evidence](implementation-notes-phase-c.md): stable CRUD and native summaries, durable principal guards, controlled private homes, owner mutation reservations, equal-ID two-process faults and production two-profile persistence are source verified. Paid actual-account and signed installed acceptance remains open; [selected 08-A baseline](../08-release-gates/baseline-06-c.md) remains blocked.
