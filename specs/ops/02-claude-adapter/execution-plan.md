# 02 — Execution plan index: Claude third native runtime

**Date:** 2026-10-04

**Status:** Planned

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

Default slot 5: 03-D and 04-D → A → B → C → D. A recorded 04/02 scheduling swap may use 03-D directly. Early 06-B/C extend for installed Claude; 06-D decides the expanded subset release. No downstream Codex dependency.

| Phase | Plan | Effort | Delivery gate |
| --- | --- | --- | --- |
| A | [native SDK, current auth policy and connection profiles](execution-plan-phase-a-sdk-auth.md) | M/L | Adapter prerequisite |
| B | [profile-bound native sessions and events](execution-plan-phase-b-session-events.md) | M/L | Adapter prerequisite |
| C | [permissions, native settings and ecosystem capabilities](execution-plan-phase-c-capabilities.md) | M/L | Adapter prerequisite |
| D | [installed recovery, security and baseline acceptance](execution-plan-phase-d-hardening-exit.md) | M/L | Expanded release baseline |

## Delivery policy

Use supported pinned native harness and current official auth/config documentation. All persistence/routing/catalog/auth/status paths include profile scope. Optional native features use capabilities/extensions; fake fixtures alone do not prove native history/policy. Real credential smokes are opt-in; no persisted-data migration.

## Exit verification

- Independent profile/native history and host failure settlement.
- Native capability honesty and permission semantics, no prompt substitutes.
- SDK/native assets in installed app and exact support/version evidence.
- Healthy prior runtimes remain usable; subset release is independent of complete roadmap.

## Task tracking

Use `AS02-<phase>-<NN>` for task IDs. Folder prefixes are stable milestone identities, not delivery order. Planned dependencies are conditions to satisfy, not claims that upstream work is Done. Keep scope bounded by task acceptance; record fixtures, version/support scope and residual gaps. Mark only implemented and verified tasks `[DONE]` and log changes in `specs/changelog.md`.
