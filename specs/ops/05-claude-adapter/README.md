# 05 — Claude native adapter

**Updated:** 2026-10-04

**Status:** Planned

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
| AS05-A | [SDK, auth and profiles](execution-plan-phase-a-sdk-auth.md) | Planned |
| AS05-B | [Native session/event lifecycle](execution-plan-phase-b-session-events.md) | Planned |
| AS05-C | [Permissions/config/ecosystem](execution-plan-phase-c-capabilities.md) | Planned |
| AS05-D | [Installed baseline acceptance](execution-plan-phase-d-hardening-exit.md) | Planned |

## Dependencies and delivery

Default order: 02-D + 04-C → 05-A → 05-B → 05-C → 05-D. An explicit OpenCode/Claude scheduling swap may use accepted Codex directly. Extend 03-A/B and selected-scope 08-A for installed Claude.

## Definition of done

- [ ] A–D contract/native feature/auth/security evidence accepted.
- [ ] Installed SDK/native assets, same-profile restart and healthy-runtime independence verified.
- [ ] Applicable release matrix, setup/recovery docs and changelog recorded.
- [ ] Setup/support limitations, accepted evidence and changelog updated when implementation lands.

No persisted-data migrations or compatibility shims. Planned prerequisites are gates, not claims of completed work. Archival of earlier implementation does not close reopened acceptance.
