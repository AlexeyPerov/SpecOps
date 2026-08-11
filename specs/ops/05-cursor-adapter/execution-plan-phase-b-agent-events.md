# 05 — Phase B: durable agents/runs and normalized events

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisite:** Phase A Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Deliver local agent/run lifecycle, streaming, follow-up, cancellation and recovery.

## Agent handoff boundary

Own native agent/run ids, workspace `cwd`, streams, tool/status/usage mapping,
follow-up, reconnect, cancel, and recorded fixtures.

## Tasks

### AS05-B-01 — Create and bind local agents

Create agents with the real workspace `rootPath`, selected model/mode, supported
settings, and immutable native agent/run binding.

**Acceptance:** Multiple sessions in one workspace retain independent durable ids.

### AS05-B-02 — Normalize run streams

Map text/reasoning, tools, changes, usage, status, errors, unknown events, and
terminal completion with stable correlation and sequence behavior.

**Acceptance:** Each run terminates exactly once; unknown SDK events remain diagnostic.

### AS05-B-03 — Follow-up, reconnect and restore

Implement subsequent prompts and reconnect/resume to the extent supported by
the pinned SDK; expose missing native history honestly.

**Acceptance:** Restart restores as supported without fabricating continuity or overwriting local metadata.

### AS05-B-04 — Cancellation and lifecycle fixtures

Map cancel semantics and record success, tools, usage, reconnect, failure,
cancellation, and missing-history cases.

**Acceptance:** Shared adapter lifecycle contract passes with documented exceptions only where capability says unsupported.

## Verification

- Run shared adapter and event fixture suites.
- Manually create two sessions, follow up, cancel, restart and reconnect.
- Confirm runtime beta/offline state does not affect other adapters.

## Handoff

Phase C starts when the lifecycle vertical slice works through common Sessions UI.
