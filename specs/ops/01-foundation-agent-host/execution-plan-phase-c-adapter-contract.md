# 01 — Phase C: adapter core, capabilities and fake runtime

> Historical implementation record. The 2026-10-04 [active index](execution-plan.md) supersedes delivery/handoff instructions here. Landed tasks remain recorded; acceptance gaps are reopened in [S](execution-plan-phase-s-stabilization.md), 03-A and 06-C as allocated by the [scope](README.md). This is not an active instruction to implement another adapter or mark the foundation fully accepted.

**Date:** 2026-08-11  
**Status:** Historical implementation complete; active acceptance tracked in S / 03-A / 06-C.
**Prerequisite:** Phase B Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Specify the smallest useful adapter core and prove it with a deterministic fake.

## Agent handoff boundary

Own adapter interfaces, capability schemas, extension boundaries, contract
tests, and the fake runtime. Do not add any vendor adapter.

## Tasks

### AS01-C-01 [DONE] — Define mandatory adapter core

Specify describe, authenticate, create, resume, send stream, cancel, health,
and terminal-state semantics with typed errors and cancellation behavior.

**Acceptance:** Every mandatory method is needed by common UI and has a testable
behavioral contract; no optional feature is represented as a required no-op.

### AS01-C-02 [DONE] — Define capabilities and extensions

Create versioned capability ids/details and optional contracts for catalogs,
permissions/questions, lifecycle, checkpoints, configuration, MCP, skills,
todos, diffs, and diagnostics.

**Acceptance:** Unsupported actions are absent or explainably disabled; runtime
settings can extend the UI without widening the core.

### AS01-C-03 [DONE] — Build deterministic fake runtime

Implement scripted create/resume/stream/cancel, tools, questions, permissions,
errors, unknown events, interruption, and restart behavior.

**Acceptance:** Tests can reproduce every common UI state without time races,
network access, credentials, or vendor binaries.

### AS01-C-04 [DONE] — Build shared adapter contract suite

Test lifecycle ordering, sequence ids, malformed/unknown events, cancellation,
terminal exclusivity, restart, capability honesty, and secret-shaped values.

**Acceptance:** Fake runtime passes; the suite can be reused unchanged by phases
02–05.

## Verification

- Run contract, domain and fake-runtime suites.
- Review mandatory interface methods against at least the four planned runtimes.
- Confirm frontend-facing packages import only common contracts.

## Historical handoff superseded

Follow the active execution index: stabilize S, then Codex 03-A. Earlier handoff and Done instructions no longer determine delivery order.
