# 02 — Phase B: native sessions, resume and normalized events

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisite:** Phase A Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Deliver the complete native session and turn lifecycle through common events.

## Agent handoff boundary

Own create/resume/send/cancel, native-id persistence, event normalization, and
terminal semantics. Optional configuration and rich capabilities belong to Phase C.

## Tasks

### AS02-B-01 — Create and bind native sessions

Set workspace `rootPath` as `cwd`, pass supported setting sources, capture the
native session id, and persist it in the immutable common binding.

**Acceptance:** Two sessions in one workspace retain distinct native ids and settings.

### AS02-B-02 — Normalize the turn stream

Map initialization, assistant text/reasoning, tools, results, usage/cost,
errors, unknown events, and terminal result into ordered `AgentEvent` values.

**Acceptance:** Every turn reaches exactly one terminal state and preserves unknown events diagnostically.

### AS02-B-03 — Resume, fork and interruption behavior

Implement explicit resume and fork only when supported; handle missing or
interrupted native history with a non-destructive, actionable session state.

**Acceptance:** App restart resumes each session independently; missing history does not overwrite SpecOps metadata.

### AS02-B-04 — Cancellation and lifecycle fixtures

Map abort/cancel, distinguish user cancellation from failure, and add recorded
fixtures for success, tool use, failure, interruption, resume, and cancellation.

**Acceptance:** Cancel settles the active turn once and leaves the session reusable when supported.

## Verification

- Run shared adapter contract and recorded-event fixture suites.
- Manually create two sessions, restart, resume, stream and cancel.
- Confirm a missing-native-history fixture produces an actionable UI state.

## Handoff

Phase C starts when the lifecycle vertical slice works through the common UI
without adapter-specific frontend branches.
