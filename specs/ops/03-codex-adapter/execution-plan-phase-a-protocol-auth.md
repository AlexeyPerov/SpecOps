# 03 — Phase A: app-server protocol bootstrap and authentication

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisite:** Milestone 02 Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Supervise a pinned app-server and expose its supported account/login lifecycle.

## Agent handoff boundary

Own process bootstrap, generated bindings/schemas, initialization, account
requests, and auth UI state. Thread/turn streaming belongs to Phase B.

## Tasks

### AS03-A-01 — Resolve and supervise the pinned runtime

Define supported version discovery, packaged/PATH resolution, stdio launch,
health, shutdown, and independent offline/error state inside Agent Host.

**Acceptance:** Host reports the exact runtime/protocol version and can restart it without affecting other adapters.

### AS03-A-02 — Generate and pin protocol contracts

Generate TypeScript bindings and JSON schemas from the supported runtime,
record generation instructions, and validate initialization/version negotiation.

**Acceptance:** Generated artifacts are reproducible; incompatible initialization fails before feature calls.

### AS03-A-03 — Implement account lifecycle

Map account read/update, login start/completion/cancel, logout, API-key login,
ChatGPT browser login, and device-code login exposed by the pinned protocol.

**Acceptance:** Concurrent/stale login completions are correlated by login id and cannot overwrite newer state.

### AS03-A-04 — Auth and bootstrap tests

Cover missing runtime, version mismatch, auth variants, cancellation, logout,
redaction, stale notifications, and independent adapter health.

**Acceptance:** Automated tests need no live account; real auth remains manually gated.

## Verification

- Regenerate schemas and confirm a clean diff.
- Run process, initialization, account, login and redaction fixtures.
- Manually gate one supported login flow before Phase B integration.

## Handoff

Phase B starts when an authenticated initialized connection is stable and all
requests/notifications are schema validated.
