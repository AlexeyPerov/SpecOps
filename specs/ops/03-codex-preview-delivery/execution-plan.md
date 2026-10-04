# 03 — Execution plan index: Early Codex preview delivery

**Updated:** 2026-10-04

**Status:** Planned

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

03-A requires 02-B activity descriptors. 03-B design/build starts after 01-S and uses 02-B for native runtime smoke. A and B do not depend on each other. Both gate 02-D and each selected-scope 08-A release; extend them as later adapters/platforms ship.

| Phase | Plan | Effort |
| --- | --- | --- |
| A | [Workspace activity and writers](execution-plan-phase-a-observability.md) | M/L |
| B | [Installed build, diagnostics and recovery](execution-plan-phase-b-packaging-diagnostics.md) | M/L |

## Acceptance

- Writer/Stop/external-edit visibility accepted for two Codex threads, later for enabled profiles/vendors.
- Installed macOS host/Node/native setup and recovery verified outside checkout.
- Diagnostics canaries, component-version checks and orphan-free shutdown pass.

## Task tracking

Task prefix is `AS03-<phase>-<NN>`. Numeric folders reflect the default delivery sequence; cross-stage gates and later/recurring work are explicit above. Mark only implemented and verified tasks `[DONE]`, record pinned contracts and actual smoke/support scope, and update `specs/changelog.md`. Completed records live in [done](../done/README.md); open acceptance remains active.
