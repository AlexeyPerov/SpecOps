# 05 — Execution plan index: Cursor feasibility and native integration

**Date:** 2026-10-04

**Status:** Planned

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

Default slot 7. Technical prerequisites: accepted Codex baseline and profile/contract/early 06-B/C infrastructure; use lessons from enabled OpenCode/Claude adapters. A → B → C → D. Handoff is not a prerequisite; extend enabled pairs when advertised.

| Phase | Plan | Effort | Delivery gate |
| --- | --- | --- | --- |
| A | [feasibility, auth and installed SDK bootstrap](execution-plan-phase-a-sdk-auth.md) | M/L | Native feasibility |
| B | [durable native agents, runs and recovery](execution-plan-phase-b-agent-events.md) | M/L | Adapter prerequisite |
| C | [native capability ledger and cloud boundary](execution-plan-phase-c-capabilities-cloud.md) | M/L | Adapter prerequisite |
| D | [installed native acceptance and release extension](execution-plan-phase-d-hardening-exit.md) | M/L | Expanded release baseline |

## Delivery policy

Use supported pinned native harness and current official auth/config documentation. All persistence/routing/catalog/auth/status paths include profile scope. Optional native features use capabilities/extensions; fake fixtures alone do not prove native history/policy. Real credential smokes are opt-in; no persisted-data migration.

## Exit verification

- Independent profile/native history and host failure settlement.
- Native capability honesty and permission semantics, no prompt substitutes.
- SDK/native assets in installed app and exact support/version evidence.
- Healthy prior runtimes remain usable; subset release is independent of complete roadmap.

## Task tracking

Use `AS05-<phase>-<NN>` for task IDs. Folder prefixes are stable milestone identities, not delivery order. Planned dependencies are conditions to satisfy, not claims that upstream work is Done. Keep scope bounded by task acceptance; record fixtures, version/support scope and residual gaps. Mark only implemented and verified tasks `[DONE]` and log changes in `specs/changelog.md`.
