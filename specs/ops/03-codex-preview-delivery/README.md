# 03 — Early Codex preview delivery

**Updated:** 2026-10-04

**Status:** Planned

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Archived audit](../done/reviews/audit-2026-10-04.md) · [Completed implementation records](../done/README.md)

Shared activity and installed packaging/diagnostics are independent early gates for a usable Codex preview. They do not wait for handoff or other adapters.

## Decisions

- Shared cwd warns/observes; never lock, serialize, isolate or automate git recovery.
- Bundle compatible host/Node; native executable distribution/setup must be explicit.
- Bounded allowlisted support diagnostics omit credential homes/auth fields/raw tool output.

## Active scope

| Phase | Plan | State |
| --- | --- | --- |
| AS03-A | [Workspace activity and writers](execution-plan-phase-a-observability.md) | Planned |
| AS03-B | [Installed build, diagnostics and recovery](execution-plan-phase-b-packaging-diagnostics.md) | Planned |

## Dependencies and delivery

03-A requires 02-B activity descriptors. 03-B design/build starts after 01-S and uses 02-B for native runtime smoke. A and B do not depend on each other. Both gate 02-D and each selected-scope 08-A release; extend them as later adapters/platforms ship.

## Definition of done

- [ ] Writer/Stop/external-edit visibility accepted for two Codex threads, later for enabled profiles/vendors.
- [ ] Installed macOS host/Node/native setup and recovery verified outside checkout.
- [ ] Diagnostics canaries, component-version checks and orphan-free shutdown pass.
- [ ] Setup/support limitations, accepted evidence and changelog updated when implementation lands.

No persisted-data migrations or compatibility shims. Planned prerequisites are gates, not claims of completed work. Archival of earlier implementation does not close reopened acceptance.

AS04-C extends early shared activity and host/Node/native asset/support source infrastructure; source and external acceptance are separated in [04-C evidence](../04-opencode-adapter/implementation-notes-phase-c.md) and [the blocked subset baseline](../08-release-gates/baseline-04-c.md). Installed/live evidence remains open; this does not mark the phase Done.
