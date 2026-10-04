# 05 — Execution plan index: Claude native adapter

**Updated:** 2026-10-04

**Status:** A–C source native sessions/interactions/policies implemented; D and installed/live gates remain open.

**Evidence:** [Phase A notes](implementation-notes-phase-a.md) · [Phase B notes](implementation-notes-phase-b.md) · [Phase C notes](implementation-notes-phase-c.md)

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

Default order: 02-D + 04-C → 05-A → 05-B → 05-C → 05-D. An explicit OpenCode/Claude scheduling swap may use accepted Codex directly. Extend 03-A/B and selected-scope 08-A for installed Claude.

| Phase | Plan | Effort |
| --- | --- | --- |
| A | [SDK, auth and profiles](execution-plan-phase-a-sdk-auth.md) | M/L |
| B | [Native session/event lifecycle](execution-plan-phase-b-session-events.md) | L |
| C | [Permissions/config/ecosystem](execution-plan-phase-c-capabilities.md) | M/L |
| D | [Installed baseline acceptance](execution-plan-phase-d-hardening-exit.md) | M/L |

## Acceptance

- A–D contract/native feature/auth/security evidence accepted.
- Installed SDK/native assets, same-profile restart and healthy-runtime independence verified.
- Applicable release matrix, setup/recovery docs and changelog recorded.

## Task tracking

Task prefix is `AS05-<phase>-<NN>`. Numeric folders reflect the default delivery sequence; cross-stage gates and later/recurring work are explicit above. Mark only implemented and verified tasks `[DONE]`, record pinned contracts and actual smoke/support scope, and update `specs/changelog.md`. Completed records live in [done](../done/README.md); open acceptance remains active.
