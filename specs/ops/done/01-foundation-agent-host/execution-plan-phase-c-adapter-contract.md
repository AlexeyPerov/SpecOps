# 01 — Phase C: adapter core, capabilities and fake runtime

> Completed implementation record. Original task IDs are preserved as historical evidence. Open acceptance and current delivery are in [active stabilization](../../01-foundation-stabilization/execution-plan.md) and the [roadmap](../../roadmap.md); archiving is not new acceptance.

**Date:** 2026-08-11
**Status:** Historical implementation complete; open acceptance tracked in 01-S / 02-A / 03-B.
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

## Current follow-up

Use [01 stabilization](../../01-foundation-stabilization/execution-plan.md), then [02 Codex](../../02-codex-adapter/execution-plan.md). Historical IDs and original task descriptions are not active dependency instructions.
