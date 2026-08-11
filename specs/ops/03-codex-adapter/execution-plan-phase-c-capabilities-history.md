# 03 — Phase C: modes, account state and native-history reconciliation

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisite:** Phase B Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Expose supported runtime depth while keeping native history authoritative.

## Agent handoff boundary

Own model/mode descriptors, sandbox/autonomy controls, account/usage/rate-limit
state, history reconciliation, and capability UI. Do not invent missing protocol behavior.

## Tasks

### AS03-C-01 — Models, modes and sandbox capabilities

Map model discovery/configuration and read-only/workspace-write/sandbox controls
into validated common descriptors and runtime-specific detail.

**Acceptance:** Session creation offers only valid combinations; unsupported controls are absent.

### AS03-C-02 — Account, usage and rate limits

Map account updates, usage reads, rate-limit snapshots/updates, quota state, and
logout effects without leaking auth material.

**Acceptance:** Sparse updates merge predictably and affect only this runtime’s availability/actions.

### AS03-C-03 — Reconcile native history and transcript cache

Hydrate/resume from native thread data, merge with cached normalized turns by
stable ids/cursors, and handle missing/divergent cache explicitly.

**Acceptance:** Cache never overwrites native truth or duplicates completed items after restart.

### AS03-C-04 — Capability and reconciliation tests

Cover mode combinations, account transitions, sparse rate-limit updates, stale
cache, missing native thread, duplicate notifications, and restart hydration.

**Acceptance:** Common UI remains usable if account/rate-limit data is temporarily unavailable.

## Verification

- Run capability, account-state, cache reconciliation and UI tests.
- Restart during and after a turn; verify no duplicate transcript items.
- Compare advertised modes against generated protocol schemas for the pinned runtime.

## Handoff

Phase D begins when descriptors and cached/native history behavior are stable and fully fixture-covered.
