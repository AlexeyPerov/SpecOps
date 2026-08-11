# 06 — Phase D: platform/security matrix, docs and release exit

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisites:** Phases A–C Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Verify the complete multi-runtime Sessions product and close the roadmap.

## Agent handoff boundary

Own release-level validation, cross-runtime matrix, security review, user docs,
changelog/status closure, and release recommendation. Fix only release-blocking findings.

## Tasks

### AS06-D-01 — Run supported-platform lifecycle matrix

For each supported target/runtime, cover install/resolve, auth, create, send,
tools/interactions, cancel, restart/resume, crash recovery, logout, and shutdown.

**Acceptance:** Results record version, packaging mode, pass/fail, evidence, and owner for every exception.

### AS06-D-02 — Run cross-runtime workflow matrix

Cover coexistence, independent offline state, every enabled handoff pair,
simultaneous writers, overlap warning, external edits, and workspace switching.

**Acceptance:** No runtime failure corrupts another runtime’s session or blocks workspace/editor usage.

### AS06-D-03 — Security and privacy gate

Run credential/handoff/support-bundle canaries, malformed native payloads,
oversized messages, path edge cases, permission prompts, and log review.

**Acceptance:** No secret leakage, unsafe implicit approval, or unbounded protocol path remains.

### AS06-D-04 — Documentation and release decision

Finalize setup/auth, capability table, shared-workspace risks, handoff, health,
diagnostics, recovery, limitations, and clean-state behavior. Update changelog and statuses.

**Acceptance:** README definition of done and roadmap success criteria pass or each exception has an explicit deferred owner.

### AS06-D-05 — Close roadmap

Mark phase plans, milestone, and roadmap Done; archive completed execution plans
according to repository policy when the implementation actually ships.

**Acceptance:** Release recommendation is evidence-backed and active ops contains no completed work after archival.

## Verification

- Review platform, cross-runtime, security, and documentation matrices.
- Run full automated suite and release builds.
- Manually confirm no orphan processes after app quit/crash on each supported target.

## Handoff

This is the terminal roadmap gate. Do not mark it Done until the shipped product
meets the recorded release criteria.
