# 06 — Execution plan index: early delivery and later handoff

**Date:** 2026-10-04

**Status:** Planned

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

B and C are independent early gates: 03-B → B/C → 03-D. C design/build can start after S. A follows at least two accepted adapters (default slot 6). D runs after the selected baseline gates and depends on A only if handoff is selected. There is no A → B → C chain.

| Phase | Plan | Effort | Delivery gate |
| --- | --- | --- | --- |
| B | [Early workspace activity](execution-plan-phase-b-observability.md) | M/L | Early Codex gate |
| C | [Early installed build/diagnostics](execution-plan-phase-c-packaging-diagnostics.md) | M/L | Early Codex gate |
| A | [Later reviewable handoff](execution-plan-phase-a-handoff.md) | M/L | After two accepted runtimes |
| D | [Subset release matrix and final closure](execution-plan-phase-d-release-exit.md) | M | Each release; final closure separately |

## Delivery policy

Test supported subsets, not imaginary four-runtime completion. First usable preview is macOS/Codex. Keep historical AS06-A/B/C/D IDs even though B/C execute first. B/C changes are extended and reverified as SDK/native assets or targets are added.

## Exit verification

- Installed host/Node/native setup works outside checkout.
- Shared-writer/external-edit visibility and bounded Stop/recovery.
- Allowlisted secret-safe diagnostics and profile-scoped state.
- Reviewable handoff only after its enabled-pair acceptance; no native history transfer.
- Subset release evidence cannot close unimplemented roadmap scope.

## Task tracking

Use `AS06-<phase>-<NN>` for task IDs. Folder prefixes are stable milestone identities, not delivery order. Planned dependencies are conditions to satisfy, not claims that upstream work is Done. Keep scope bounded by task acceptance; record fixtures, version/support scope and residual gaps. Mark only implemented and verified tasks `[DONE]` and log changes in `specs/changelog.md`.
