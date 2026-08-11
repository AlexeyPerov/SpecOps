# 04 — Phase B: core session, stream and interaction parity

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisite:** Phase A Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Port the mandatory Sessions lifecycle and interaction behavior to the host adapter.

## Agent handoff boundary

Own session CRUD/resume, messages, streaming, tools, permissions/questions,
cancellation, terminal state, models/providers needed for creation, and core fixtures.

## Tasks

### AS04-B-01 — Port session and message lifecycle

Map create/list/get/resume/archive as needed, native ids, message hydration,
send, cancellation, and terminal status into the common contract.

**Acceptance:** Existing sessions behavior is reproducible through Agent Host with the new clean SpecOps store.

### AS04-B-02 — Port normalized event streaming

Translate text/reasoning, tool, step/subtask, diff, usage/cost, error, compaction,
unknown, and reconnect events with stable ordering/correlation.

**Acceptance:** Legacy and host fixture outputs match at the normalized-event boundary or document an intentional correction.

### AS04-B-03 — Port permissions and questions

Map incoming requests and replies, cancellation/timeouts, abort, and stale-event
handling through shared extensions.

**Acceptance:** Allow/deny/answer/cancel paths render and resolve exactly once through common UI.

### AS04-B-04 — Core parity test gate

Run shared adapter contract plus side-by-side fixture comparison for lifecycle,
stream, tool, interaction, failure, restart, and cancel cases.

**Acceptance:** No unresolved core-parity difference remains before optional features begin.

## Verification

- Run shared adapter suite and legacy/new normalized fixture comparison.
- Manually execute create/send/tool/question/permission/cancel/restart through the new path.
- Verify Claude and Codex sessions remain unaffected.

## Handoff

Phase C begins when common Sessions behavior reaches parity and all remaining
gaps are explicitly optional extensions.
