# 05 — Phase D: recovery, security and milestone exit

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisites:** Phases A–C Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Prove the beta adapter is isolated, secret-safe, recoverable, and ready for handoff work.

## Agent handoff boundary

Own fault/security closure, shared contract execution, gated real-key smoke,
packaging, docs, and milestone status. Do not implement cloud execution.

## Tasks

### AS05-D-01 — Fault and recovery matrix

Cover missing/incompatible SDK, offline service, invalid/expired auth, quota,
stream disconnect, host crash, cancel race, missing history, and restart.

**Acceptance:** Errors are actionable and isolated to this runtime/session.

### AS05-D-02 — Security and redaction audit

Run secret canaries through auth, errors, raw SDK events, transcript cache,
logs, snapshots, and diagnostic export.

**Acceptance:** No canary crosses a prohibited boundary.

### AS05-D-03 — Contract, real-key and packaging smoke

Run shared adapter suite and gated create/send/tool/follow-up/cancel/reconnect
smoke from a packaged host on supported platforms.

**Acceptance:** Results and any beta limitations are recorded in the capability ledger.

### AS05-D-04 — Docs and milestone closure

Document setup, beta/version support, capabilities, recovery, and cloud
non-scope; update changelog, README, index, and roadmap statuses.

**Acceptance:** Phase 06 receives a stable four-runtime descriptor set.

## Verification

- Run all milestone-05 automated suites, build and type checks.
- Complete gated real-key and packaging smoke records.
- Review README definition-of-done and capability ledger.

## Handoff

Mark milestone 05 Done and hand the stable runtime set to phase 06.
