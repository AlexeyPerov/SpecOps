# 03 — Phase B: thread/turn lifecycle and streamed events

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisite:** Phase A Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Map native threads and turns into the common Sessions lifecycle.

## Agent handoff boundary

Own thread start/resume, turn start/steer/cancel, item/event normalization,
approvals/questions, terminal behavior, and recorded fixtures.

## Tasks

### AS03-B-01 — Bind SpecOps sessions to native threads

Implement thread start/resume/read as supported, persist immutable native ids,
and isolate thread state by SpecOps session and process generation.

**Acceptance:** Two sessions retain distinct threads and resume independently after app-server restart.

### AS03-B-02 — Normalize turn and item streams

Map turn start, item start/update/complete, text/reasoning deltas, tools,
changes, usage, errors, unknown notifications, and terminal state in sequence.

**Acceptance:** Deltas assemble deterministically and each turn terminates exactly once.

### AS03-B-03 — Map approvals and questions

Translate command/file-change approvals and user-input requests into common
reply contracts with correlation, cancellation, timeout, and late-reply handling.

**Acceptance:** Every interactive request resolves once; stale replies cannot target a new turn.

### AS03-B-04 — Cancellation and stream fixtures

Implement turn cancellation/interrupt semantics and record fixtures for tools,
approvals, questions, failure, cancellation, resume, and unknown events.

**Acceptance:** Shared adapter contract passes the full lifecycle subset without frontend-specific branches.

## Verification

- Run generated-schema, stream-normalization and shared contract suites.
- Exercise two threads, restart/resume, approval allow/deny, question and cancel.
- Confirm one adapter process failure does not interrupt Claude sessions.

## Handoff

Phase C starts when the complete thread/turn vertical slice works through the common UI.
