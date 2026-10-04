# 08 — Repeatable release gates and final closure

**Updated:** 2026-10-04

**Status:** Planned

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Archived audit](../done/reviews/audit-2026-10-04.md) · [Completed implementation records](../done/README.md)

Run release acceptance for each concrete enabled runtime/platform subset, starting with macOS/Codex. Final closure follows the complete active roadmap.

## Decisions

- Release support is versioned and evidence-backed for advertised subsets.
- No all-four-runtime prerequisite for Codex preview.
- Subset release approval is distinct from full roadmap completion.

## Active scope

| Phase | Plan | State |
| --- | --- | --- |
| AS08-A | [Subset release matrix and final closure](execution-plan-phase-a-release-exit.md) | Planned |

## Dependencies and delivery

First invocation: 02-D plus 03-A/B. Later invocations require each selected adapter/feature baseline and 06-A only when handoff is advertised. Final closure requires all current active scope or explicit scope revision; a Codex-only release does not mark future phases Done.

## Definition of done

- [ ] Selected install/auth/tool/interaction/cancel/resume/logout/quit matrix passes.
- [ ] Shared activity, healthy-runtime isolation, canaries and process-tree cleanup pass.
- [ ] Advertised handoff/profile/extension scope has its own accepted gate.
- [ ] Only implemented/verified scope is marked Done; final roadmap closure is separate.
- [ ] Setup/support limitations, accepted evidence and changelog updated when implementation lands.

No persisted-data migrations or compatibility shims. Planned prerequisites are gates, not claims of completed work. Archival of earlier implementation does not close reopened acceptance.

AS04-C extends early shared activity and host/Node/native asset/support source infrastructure; source and external acceptance are separated in [04-C evidence](../04-opencode-adapter/implementation-notes-phase-c.md) and [the blocked subset baseline](../08-release-gates/baseline-04-c.md). Installed/live evidence remains open; this does not mark the phase Done.
