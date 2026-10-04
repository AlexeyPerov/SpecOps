# 07 — Execution plan index: Cursor native adapter after feasibility

**Updated:** 2026-10-05

**Status:** A–D selected source SDK/profile/lifecycle/settings/fault/security/handoff verified; authenticated native/signed installed/distribution acceptance open.

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

Technical prerequisites: 02-D and shared profile/contract/03-A/B infrastructure, with lessons from enabled adapters. Default order is after stage 06; handoff is not a technical prerequisite. 07-A → B → C → D; extend release/handoff matrices only for advertised scope.

| Phase | Plan | Effort |
| --- | --- | --- |
| A | [Feasibility, SDK/assets and auth](execution-plan-phase-a-sdk-auth.md) | M/L |
| B | [Durable native agents/runs](execution-plan-phase-b-agent-events.md) | L |
| C | [Native capabilities/cloud boundary](execution-plan-phase-c-capabilities-cloud.md) | M/L |
| D | [Installed native acceptance](execution-plan-phase-d-hardening-exit.md) | M/L |

## Acceptance

- A–D native feasibility/capability/auth/installed-asset evidence accepted.
- Profile/history/fault/security behavior matches advertised capabilities.
- Healthy prior runtimes remain usable; selected-scope 08-A release evidence recorded.

## Task tracking

Task prefix is `AS07-<phase>-<NN>`. Numeric folders reflect the default delivery sequence; cross-stage gates and later/recurring work are explicit above. Mark only implemented and verified tasks `[DONE]`, record pinned contracts and actual smoke/support scope, and update `specs/changelog.md`. Completed records live in [done](../done/README.md); open acceptance remains active.

## Current evidence

[AS07-A native feasibility ledger](implementation-notes-phase-a.md): exact official local SDK 1.0.35, isolated API-key/native catalog source and copied account-free durable JSONL/Node/native assets verified on Darwin arm64. Native turns, interactive/browser integration and Cloud execution are not advertised by this bootstrap. [Expanded release baseline](../08-release-gates/baseline-07-a.md) remains blocked; B/C/D and authenticated/signed installed/platform/distribution acceptance remain open.

[AS07-B source lifecycle evidence](implementation-notes-phase-b.md): durable per-agent native JSONL store, immutable profile/workspace/model/credential binding, bounded stream/cancel/history and production cache recovery verified. Only minimal no-tool local turns are advertised; native policy and live/installed acceptance remain C/D work. [B release baseline](../08-release-gates/baseline-07-b.md) remains blocked.

[AS07-C finite native capability ledger](implementation-notes-phase-c.md): immutable native file tool presets, boolean sandbox request and safe selected-profile catalog enum parameters are source verified. Interactive approvals/questions, hooks, fork/restore, MCP/skills/subagents and Cloud remain unavailable; no filesystem read-only guarantee is advertised. [C release baseline](../08-release-gates/baseline-07-c.md) remains blocked pending native enforcement/installed/distribution acceptance.

[AS07-D hardening/support evidence](implementation-notes-phase-d.md): native discriminant faults, bounded strict history, durable terminal ownership, exact profile/control redaction, four-runtime host death and 16 production handoff pairs verified. Optional paid native smoke is explicit/default skipped. [D release baseline](../08-release-gates/baseline-07-d.md) remains blocked pending authenticated/native enforcement, signed installed/platform/process/distribution acceptance.
