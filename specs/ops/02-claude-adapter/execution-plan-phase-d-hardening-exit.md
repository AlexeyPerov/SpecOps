# 02 — Phase D: recovery, security and milestone exit

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisites:** Phases A–C Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Prove the adapter is recoverable, secret-safe, and ready to become a contract baseline.

## Agent handoff boundary

Own hardening, test closure, documentation, and milestone status. Do not add new
capabilities unless they close a demonstrated exit gap.

## Tasks

### AS02-D-01 — Recovery and fault matrix

Cover offline startup, invalid/expired auth, quota/rate failure, SDK exception,
host crash mid-turn, missing history, and restart with two sessions.

**Acceptance:** Each state is actionable and isolated to this runtime/session.

### AS02-D-02 — Security and redaction audit

Run secret canaries through auth, errors, raw events, transcript caching, logs,
snapshots, handoff-ready summaries, and diagnostic export.

**Acceptance:** No canary crosses a prohibited boundary.

### AS02-D-03 — Shared contract and real-key smoke

Run the complete shared adapter suite and manually gated create/send/tool/
permission/cancel/resume smoke using real credentials.

**Acceptance:** Automated suite and recorded smoke checklist pass on supported development platforms.

### AS02-D-04 — Docs and milestone closure

Document setup, supported capabilities, recovery, limits, and shared-workspace
warning behavior; update changelog, README, index, and roadmap statuses.

**Acceptance:** Phase 03 can consume written contract lessons without inspecting implementation history.

## Verification

- Run all milestone-02 automated suites and type/build checks.
- Complete and record manually gated credential smoke.
- Review all milestone README definition-of-done items.

## Handoff

Mark milestone 02 Done and record any common-contract amendments before assigning phase 03.
