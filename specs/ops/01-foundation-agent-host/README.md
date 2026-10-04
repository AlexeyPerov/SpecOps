# 01 — Sessions foundation and Agent Host

**Updated:** 2026-10-04

**Status:** Historical A–F implemented (2026-08-15); acceptance reopened. Phase S Planned.

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

## Scope and current state

| Phase | Implementation record | Acceptance state |
| --- | --- | --- |
| A | [Chat/Cloud removal](execution-plan-phase-a-chat-removal.md) | Implemented; regression baseline |
| B | [Neutral domain/persistence](execution-plan-phase-b-session-domain.md) | Implemented; production binding persistence gap → S-01 |
| C | [Adapter contract/fake](execution-plan-phase-c-adapter-contract.md) | Implemented; contract evidence gaps → S-04 |
| D | [Agent Host](execution-plan-phase-d-agent-host.md) | Implemented; failure/redaction/framing gaps → S-03/04 |
| E | [Tauri supervision](execution-plan-phase-e-supervision.md) | Implemented; I/O/shutdown/generation cleanup gaps → S-02 |
| F | [Sessions UX](execution-plan-phase-f-sessions-ux-exit.md) | Implemented slice; stream recovery → S-03, runtime/profile/catalog/gate → 03-A |
| S | [Stabilization](execution-plan-phase-s-stabilization.md) | Planned; first active delivery gate |

The August Done markers describe landed code, not accepted production readiness. [Review round 1](review-issues-1.md) and [current audit](../audit-2026-10-04.md) provide evidence. Preserve historical task IDs/notes; do not rerun removal or add persistence migration.

## Decisions

- Workspace Sessions is the only AI surface; native SDK/process remains outside WebView.
- Tauri supervises one Agent Host; host owns runtime descendants, bounded I/O and shutdown.
- New storage may reset cleanly. No persisted-data migration or compatibility shim.
- Common session core stays small; native optional features use honest capabilities/extensions.
- S is foundation stabilization, not a new generic agent-platform product.

## Dependencies and allocation

S has no vendor-adapter dependency and precedes 03-A. Runtime/profile creation, native auth and neutral Sessions settings are active 03-A work; packaging/reproducibility/Node assets are active 06-C work before usable Codex preview. Those downstream gaps are explicit and do not falsely mark F accepted.

## Definition of done

- [ ] S-01–05 acceptance and the remaining-review disposition ledger pass.
- [ ] Production persistence resumes a known native binding through fresh store/host state.
- [ ] Bounded crash/restart/shutdown and error/stream fixtures pass on declared supported targets.
- [ ] Historical F creation/catalog gaps are implemented and accepted in 03-A.
- [ ] Historical packaging gaps are implemented and accepted in 06-C.
- [ ] Non-AI regression checks, supported-platform evidence and changelog are recorded.

Passing S permits Codex work. Full foundation acceptance additionally requires the explicitly allocated 03-A/06-C gates; no circular dependency requires them to finish before S.
