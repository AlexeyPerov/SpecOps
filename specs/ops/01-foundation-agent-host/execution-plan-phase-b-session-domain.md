# 01 — Phase B: runtime-neutral session domain and persistence

**Date:** 2026-08-12  
**Status:** Done  
**Prerequisite:** Phase A Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Define a clean common session model with immutable native runtime binding.

## Agent handoff boundary

Own domain types, codecs, persistence, and normalized transcript primitives.
Do not implement host transport or a real runtime adapter.

## Tasks

### AS01-B-01 [DONE] — Define ids, binding and lifecycle

Introduce runtime id, SpecOps session/turn ids, native binding, model/mode
metadata, terminal states, timestamps, and immutable runtime rules.

**Acceptance:** SpecOps and native ids cannot be confused by type/API shape;
runtime changes require creation of a new session.

### AS01-B-02 [DONE] — Define normalized turns and events

Model text, reasoning, tools, subtasks, steps, attachments, diffs, usage/cost,
compaction, questions, permissions, status, diagnostic, and unknown events.

**Acceptance:** Common UI payloads contain no vendor SDK types; unknown native
events remain representable as diagnostics.

### AS01-B-03 [DONE] — Replace persistence schema

Add new codecs and session-store records around the native binding and cached
transcript. Delete legacy AI compatibility and provider-specific persisted fields.

**Acceptance:** Fresh state round-trips deterministically; corrupt records fail
or reset explicitly without a silent partial decode.

### AS01-B-04 [DONE] — Domain and codec tests

Cover every union variant, immutable binding, unknown events, malformed data,
and restart round-trips with fixed fixtures.

**Acceptance:** Domain/codec suite is exhaustive and provider-independent.

## Verification

- Run domain, codec, persistence, and type-check suites.
- Search common state for provider-prefixed fields/types.
- Review serialized fixtures for credentials and raw native payloads.

## Handoff

Phase C may start when the schema is stable enough to define adapter contracts
without provider-specific exceptions.
