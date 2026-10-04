# 08 — Execution plan index: Repeatable release gates and final closure

**Updated:** 2026-10-04

**Status:** Planned

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

First invocation: 02-D plus 03-A/B. Later invocations require each selected adapter/feature baseline and 06-A only when handoff is advertised. Final closure requires all current active scope or explicit scope revision; a Codex-only release does not mark future phases Done.

| Phase | Plan | Effort |
| --- | --- | --- |
| A | [Subset release matrix and final closure](execution-plan-phase-a-release-exit.md) | M |

## Acceptance

- Selected install/auth/tool/interaction/cancel/resume/logout/quit matrix passes.
- Shared activity, healthy-runtime isolation, canaries and process-tree cleanup pass.
- Advertised handoff/profile/extension scope has its own accepted gate.
- Only implemented/verified scope is marked Done; final roadmap closure is separate.

## Task tracking

Task prefix is `AS08-<phase>-<NN>`. Numeric folders reflect the default delivery sequence; cross-stage gates and later/recurring work are explicit above. Mark only implemented and verified tasks `[DONE]`, record pinned contracts and actual smoke/support scope, and update `specs/changelog.md`. Completed records live in [done](../done/README.md); open acceptance remains active.

AS04-C extends early shared activity and host/Node/native asset/support source infrastructure; source and external acceptance are separated in [04-C evidence](../04-opencode-adapter/implementation-notes-phase-c.md) and [the blocked subset baseline](../08-release-gates/baseline-04-c.md). Installed/live evidence remains open; this does not mark the phase Done.
