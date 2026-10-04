# 02 — Claude native adapter

**Date:** 2026-10-04

**Status:** Planned

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Implementation audit](../audit-2026-10-04.md)

Claude is the scheduled third native runtime, after the usable Codex preview and OpenCode core cutover. It is not a prerequisite for Codex.

## Decisions

- Use the official native Agent SDK inside Agent Host; retain its agent loop/tools/history.
- Verify current third-party auth policy and pinned native flow; API key/cloud is baseline, supported additional auth is evidence-dependent.
- Profile-bound credentials/config/native history and native permissions; no prompt emulation.

## Scope and current state

| Phase | Work | State |
| --- | --- | --- |
| AS02-A | [native SDK, current auth policy and connection profiles](execution-plan-phase-a-sdk-auth.md) | Missing |
| AS02-B | [profile-bound native sessions and events](execution-plan-phase-b-session-events.md) | Missing |
| AS02-C | [permissions, native settings and ecosystem capabilities](execution-plan-phase-c-capabilities.md) | Missing |
| AS02-D | [installed recovery, security and baseline acceptance](execution-plan-phase-d-hardening-exit.md) | Missing |

## Dependencies and delivery

Default slot 5: 03-D and 04-D → A → B → C → D. A recorded 04/02 scheduling swap may use 03-D directly. Early 06-B/C extend for installed Claude; 06-D decides the expanded subset release. No downstream Codex dependency.

## Expected outcomes

- Independent native sessions use real workspace cwd, fixed profile and native history.
- Native tools/config/policy and UI capabilities match pinned evidence.
- Installed offline/auth/crash/restart/cancel behavior is safe and does not disable healthy runtime.

## Out of scope

- Subscription login without verified supported integration policy/flow.
- Handoff implementation, migrations or widening core for optional native features.

## Definition of done

- [ ] A–D task acceptance and actual native feature/config/auth ledger pass.
- [ ] Profile-scoped contract/security/native restart tests pass for advertised capabilities.
- [ ] Installed assets, current auth smoke/support scope and early shared activity/recovery checks recorded.
- [ ] Selected-scope 06-D matrix, setup/recovery docs and changelog updated.
