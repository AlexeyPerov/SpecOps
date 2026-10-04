# 04 — OpenCode core cutover, then native extensions

**Date:** 2026-10-04

**Status:** Planned

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Implementation audit](../audit-2026-10-04.md)

OpenCode is the scheduled second production runtime. Existing code/fixtures are input to a new host adapter; they are not proof of current Sessions parity.

## Decisions

- Use one native owner in every intermediate state; host becomes sole owner at D.
- Maintain required/retained/deferred ledger from A, before core implementation.
- Execute A → B → D; optional C follows later and cannot block Codex/OpenCode baseline.
- No frontend vendor SDK after core cutover; provider details remain native host extensions.

## Scope and current state

| Phase | Work | State |
| --- | --- | --- |
| AS04-A | [Ownership and finite parity ledger](execution-plan-phase-a-host-lifecycle.md) | Legacy implementation; host adapter missing |
| AS04-B | [Core session/event parity](execution-plan-phase-b-core-parity.md) | Legacy implementation; host core missing |
| AS04-D | [Core cutover and acceptance](execution-plan-phase-d-cutover-exit.md) | Missing |
| AS04-C | [Later optional native extensions](execution-plan-phase-c-extensions-ui.md) | Later; missing |

## Dependencies and delivery

Codex 03-D → A → B → D. D extends early 06-B/C for this runtime and unblocks default Claude slot. C follows D in slot 6. Handoff is eligible once this second baseline is accepted; no Claude prerequisite for core.

## Expected outcomes

- Codex/OpenCode native histories and profiles coexist independently.
- Core cutover removes legacy frontend SDK and supervisor path.
- Rich features ship later only with explicit ledger evidence.

## Out of scope

- Persisted-state migration or complete rich-feature parity as a core release gate.
- Mandatory core methods for vendor-specific capabilities.
- New unscoped feature expansion.

## Definition of done

- [ ] A/B/D core baseline, profile isolation and installed coexistence accepted.
- [ ] Legacy execution and frontend SDK path removed at D.
- [ ] Every legacy category has core/retained/deferred disposition and docs.
- [ ] Retained C features accepted separately before full milestone Done, or explicit scope revision.
- [ ] Applicable 06-D evidence, runtime setup/recovery docs and changelog recorded.
