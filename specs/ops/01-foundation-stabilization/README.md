# 01 — Foundation acceptance stabilization

**Updated:** 2026-10-04

**Status:** Planned

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Archived audit](../done/reviews/audit-2026-10-04.md) · [Completed implementation records](../done/README.md)

Historical implementation A–F is archived in done. Only reopened stabilization S is active here.

## Decisions

- Bound persistence, I/O, streams, errors, framing and process cleanup before real credentials.
- Keep implemented history separate from open acceptance; no persistence migration.

## Active scope

| Phase | Plan | State |
| --- | --- | --- |
| AS01-S | [Stabilization](execution-plan-phase-s-stabilization.md) | Planned |

## Dependencies and delivery

AS01-S precedes Codex AS02-A. Native profile/creation/catalog gaps belong to 02-A; installed build gaps belong to 03-B. Full foundation acceptance includes those allocated downstream gates, while S alone permits Codex work.

## Definition of done

- [ ] Production binding survives fresh-store/host restart; no hidden new native session.
- [ ] No hung request/turn/quit, secret-bearing error or orphan process on supported targets.
- [ ] Remaining Critical/Major review findings have evidence-backed task dispositions.
- [ ] Setup/support limitations, accepted evidence and changelog updated when implementation lands.

No persisted-data migrations or compatibility shims. Planned prerequisites are gates, not claims of completed work. Archival of earlier implementation does not close reopened acceptance.
