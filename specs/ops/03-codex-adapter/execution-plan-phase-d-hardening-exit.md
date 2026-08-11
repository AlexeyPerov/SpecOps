# 03 — Phase D: protocol drift, security and milestone exit

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisites:** Phases A–C Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Prove version safety, credential safety, runtime isolation, and release readiness.

## Agent handoff boundary

Own fault/security closure, shared contract execution, gated auth smokes, docs,
and status updates. Do not absorb phase-04 migration work.

## Tasks

### AS03-D-01 — Drift and recovery matrix

Test unsupported version/schema, malformed messages, offline runtime, process
crash, auth expiry, quota/rate limit, cancellation races, and interrupted login.

**Acceptance:** Drift fails before partial stream parsing; every error is actionable and runtime-local.

### AS03-D-02 — Security and secret audit

Run API-key/token canaries through account notifications, host errors, raw
payload diagnostics, snapshots, transcripts, logs, and exported support data.

**Acceptance:** No canary crosses a prohibited boundary and logout clears adapter-held secret state.

### AS03-D-03 — Contract and credential smokes

Run shared adapter tests plus manually gated API-key and official ChatGPT login
flows covering create/send/tool/approval/cancel/resume/logout.

**Acceptance:** Both supported auth families pass recorded checklists where account access permits.

### AS03-D-04 — Docs and milestone closure

Document runtime/version requirements, auth choices, modes, rate limits,
recovery, and cache semantics; update changelog, README, index, and roadmap.

**Acceptance:** Phase 04 has a stable, documented three-layer contract: common UI, Agent Host, adapter.

## Verification

- Run all milestone-03 automated suites, build and type checks.
- Complete gated auth smoke records.
- Review README definition-of-done and protocol regeneration instructions.

## Handoff

Mark milestone 03 Done and freeze common-contract changes before assigning the migration in phase 04.
