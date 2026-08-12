# 01 — Phase D: bundled Agent Host and JSON-RPC protocol

**Date:** 2026-08-11  
**Status:** Done  
**Prerequisite:** Phase C Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Provide a secret-safe local host that owns adapters outside the WebView.

## Agent handoff boundary

Own the TypeScript host package, build artifact, stdio protocol, dispatch,
adapter registry, and protocol tests. Rust process supervision belongs to Phase E.

## Tasks

### AS01-D-01 [DONE] — Create host package and build artifact

Target the Node runtime bundled with SpecOps, define reproducible build/version
metadata, runtime discovery, fake-adapter registration, and development entrypoints.

**Acceptance:** A built host starts from the packaged path and reports its
version/runtime descriptors without the WebView importing host code.

### AS01-D-02 [DONE] — Define versioned JSON-RPC protocol

Cover initialize/version negotiation, discovery, auth, catalogs, sessions,
turns, replies, cancel, events, health, and shutdown. Set message limits,
timeouts, sequence ids, and explicit protocol errors.

**Acceptance:** Schemas are versioned and validated on both request and event
boundaries; incompatible versions fail during initialization.

### AS01-D-03 [DONE] — Implement framing, dispatch and backpressure

Implement newline/content framing as selected, correlation, cancellation,
bounded queues, stream ordering, stderr separation, and graceful shutdown.

**Acceptance:** Slow consumers cannot grow memory without bound; cancellation
and shutdown settle every pending request exactly once.

### AS01-D-04 [DONE] — Redaction and protocol fixtures

Redact credentials and secret-shaped nested fields before diagnostics. Add
golden fixtures for valid, malformed, oversized, timed-out, and unknown messages.

**Acceptance:** Secret canaries never cross the diagnostic boundary and the
protocol suite is deterministic across supported platforms.

## Verification

- Run host build, schema, framing, timeout, cancellation and redaction tests.
- Exercise fake runtime create/stream/cancel over a real stdio process.
- Inspect packaged output for deterministic version metadata.

## Handoff

Phase E begins when the host can be driven end to end from a standalone harness
and terminates cleanly on protocol shutdown.
