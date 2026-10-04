# 05 — Cursor native adapter after feasibility

**Date:** 2026-10-04

**Status:** Planned

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Implementation audit](../audit-2026-10-04.md)

Cursor follows initial native integrations. Phase A first validates current SDK/auth/storage/assets; exact capabilities follow evidence, not a predetermined parity promise.

## Decisions

- Pin tested official native local SDK/version and actual release maturity after feasibility spike.
- Support current official profile auth, API key baseline and browser flow only with verified native storage/scope.
- Verify Node/native binaries/history-store/single-file packaging on supported target before promising installed behavior.
- Keep cloud execution deferred as a runtime extension; no standalone Cloud product.

## Scope and current state

| Phase | Work | State |
| --- | --- | --- |
| AS05-A | [feasibility, auth and installed SDK bootstrap](execution-plan-phase-a-sdk-auth.md) | Missing |
| AS05-B | [durable native agents, runs and recovery](execution-plan-phase-b-agent-events.md) | Missing |
| AS05-C | [native capability ledger and cloud boundary](execution-plan-phase-c-capabilities-cloud.md) | Missing |
| AS05-D | [installed native acceptance and release extension](execution-plan-phase-d-hardening-exit.md) | Missing |

## Dependencies and delivery

Default slot 7. Technical prerequisites: accepted Codex baseline and profile/contract/early 06-B/C infrastructure; use lessons from enabled OpenCode/Claude adapters. A → B → C → D. Handoff is not a prerequisite; extend enabled pairs when advertised.

## Expected outcomes

- Independent native sessions use real workspace cwd, fixed profile and native history.
- Native tools/config/policy and UI capabilities match pinned evidence.
- Installed offline/auth/crash/restart/cancel behavior is safe and does not disable healthy runtime.

## Out of scope

- Cloud execution, generic HTTP wrapper, prompt-based permission/lifecycle emulation.
- Credential/native history transfer, persisted-data migration or mandatory future-runtime coupling.

## Definition of done

- [ ] A–D task acceptance and actual native feature/config/auth ledger pass.
- [ ] Profile-scoped contract/security/native restart tests pass for advertised capabilities.
- [ ] Installed assets, current auth smoke/support scope and early shared activity/recovery checks recorded.
- [ ] Selected-scope 06-D matrix, setup/recovery docs and changelog updated.
