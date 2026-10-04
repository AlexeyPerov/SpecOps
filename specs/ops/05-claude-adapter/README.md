# 05 — Claude native adapter

**Updated:** 2026-10-04

**Status:** A–D source bootstrap, native lifecycle/interactions/policy/recovery/security implemented; installed/live acceptance gates open.

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Archived audit](../done/reviews/audit-2026-10-04.md) · [Completed implementation records](../done/README.md)

Claude follows Codex preview and OpenCode core. It never blocks the first Codex release.

## Decisions

- Use official native Agent SDK, not model-only wrapper.
- Verify current third-party auth policy; API key/cloud baseline, additional auth only with supported flow evidence.
- Profile-scoped native history/settings/permissions and capability honesty.

## Active scope

| Phase | Plan | State |
| --- | --- | --- |
| AS05-A | [SDK, auth and profiles](execution-plan-phase-a-sdk-auth.md) | Source implemented; installed/live open |
| AS05-B | [Native session/event lifecycle](execution-plan-phase-b-session-events.md) | Developer source implemented; live/installed open |
| AS05-C | [Permissions/config/ecosystem](execution-plan-phase-c-capabilities.md) | Source implemented; live/installed enforcement open |
| AS05-D | [Installed baseline acceptance](execution-plan-phase-d-hardening-exit.md) | Source recovery/security verified; installed/live baseline open |

## Dependencies and delivery

Default order: 02-D + 04-C → 05-A → 05-B → 05-C → 05-D. An explicit OpenCode/Claude scheduling swap may use accepted Codex directly. Extend 03-A/B and selected-scope 08-A for installed Claude.

## Definition of done

- [ ] A–D contract/native feature/auth/security evidence accepted.
- [ ] Installed SDK/native assets, same-profile restart and healthy-runtime independence verified.
- [ ] Applicable release matrix, setup/recovery docs and changelog recorded.
- [x] Source setup/support limitations, evidence and changelog recorded; installed/live evidence remains open.

No persisted-data migrations or compatibility shims. Planned prerequisites are gates, not claims of completed work. Archival of earlier implementation does not close reopened acceptance.

Phase A evidence and supported auth/assets are recorded in [implementation notes](implementation-notes-phase-a.md). [Phase B evidence](implementation-notes-phase-b.md) records developer native lifecycle and authoritative history.  [Phase C evidence and feature ledger](implementation-notes-phase-c.md) records native correlated interactions and immutable policy descriptors. Native source turns now default enabled for an authenticated profile; installed/live policy enforcement remains open. Native approval is not a read-only sandbox; filesystem settings remain isolated with a managed policy/memory qualification.

[Phase D recovery/security/setup evidence](implementation-notes-phase-d.md) and [blocked expanded subset decision](../08-release-gates/baseline-05-d.md) distinguish source readiness from installed/live acceptance. API key baseline only; no unsupported subscription/cloud auth or inferred native sandbox.
