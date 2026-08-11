# 04 — Phase A: Agent Host ownership and runtime lifecycle

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisites:** Milestones 01–03 Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Move SDK/client and runtime ownership out of the WebView without double supervision.

## Agent handoff boundary

Own adapter packaging, runtime resolution, process ownership, health, auth/config
bootstrap, and a minimal connection probe. Core session parity belongs to Phase B.

## Tasks

### AS04-A-01 — Freeze legacy ownership and behavior

Map current frontend client, Rust supervisor, child runtime, startup/config/auth,
health, and shutdown flows; capture process and connection fixtures.

**Acceptance:** The cutover map identifies one future owner for every lifecycle responsibility.

### AS04-A-02 — Move client code into Agent Host

Relocate SDK/server client dependencies behind an adapter module and remove
them from the WebView build graph without changing user-visible behavior.

**Acceptance:** Agent Host can connect/probe the runtime; frontend has no direct client import in the migrated slice.

### AS04-A-03 — Transfer runtime lifecycle ownership

Make Agent Host launch/connect, monitor, restart, and stop the child runtime.
Ensure Tauri supervises only Agent Host for the new path.

**Acceptance:** Exactly one supervisor owns the runtime in every feature-gate state; shutdown leaves no child process.

### AS04-A-04 — Bootstrap and process tests

Cover missing binary, PATH override, auth/config failure, port/connection failure,
crash, restart, shutdown, and old/new feature-gate selection.

**Acceptance:** Process tests are deterministic and prove no double launch or orphan.

## Verification

- Inspect WebView bundle/import graph for migrated client dependencies.
- Run host adapter bootstrap and Tauri/host process-tree tests.
- Toggle legacy/new path and verify only one runtime instance exists.

## Handoff

Phase B starts when Agent Host owns a stable authenticated runtime connection
and the legacy path remains available only as a parity reference.
