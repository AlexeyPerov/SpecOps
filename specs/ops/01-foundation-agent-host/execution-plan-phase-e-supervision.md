# 01 — Phase E: Tauri supervision and process-tree cleanup

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisite:** Phase D Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Make Agent Host a resilient, observable, fully reaped application child.

## Agent handoff boundary

Own Rust/Tauri spawning, IPC bridge, lifecycle policy, and process cleanup.
Do not add runtime-specific lifecycle code to Tauri.

## Tasks

### AS01-E-01 — Implement reusable host supervisor

Track process generation, path/version, health, stdout/stderr drainers, pending
requests, exit reason, restart eligibility, and crash-loop breaker.

**Acceptance:** At most one active host generation owns requests; stale events
cannot mutate the new generation.

### AS01-E-02 — Bridge commands and events

Route validated UI requests through Tauri to host JSON-RPC and route normalized
events back with session/turn correlation and bounded buffering.

**Acceptance:** WebView never spawns, connects to, or imports a vendor/host
runtime directly; protocol failures become typed UI errors.

### AS01-E-03 — Implement shutdown and recovery policy

Handle normal quit, settings/runtime changes, host crash, hung shutdown, forced
termination, and process-group cleanup for children and grandchildren.

**Acceptance:** Every path drains pipes, resolves pending calls, and reaps the
entire process tree within bounded time.

### AS01-E-04 — Supervision tests

Use controllable fixture processes for healthy exit, crash loops, ignored
shutdown, noisy stderr, child spawning, and stale-generation events.

**Acceptance:** Tests prove no orphan process remains on supported platforms.

## Verification

- Run Rust/Tauri unit and integration tests.
- Manually kill/hang host during an active fake turn and verify recovery state.
- Quit the app during a child-spawning fixture and inspect the process tree.

## Handoff

Phase F starts when fake-runtime traffic reliably crosses UI → Tauri → host and
all supervised failure paths are deterministic.
