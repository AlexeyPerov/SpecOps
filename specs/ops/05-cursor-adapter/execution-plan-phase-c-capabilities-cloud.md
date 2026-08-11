# 05 — Phase C: capability gaps and cloud deferral boundary

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisite:** Phase B Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Represent actual SDK behavior without prompt emulation or a separate Cloud product lane.

## Agent handoff boundary

Own capability audit/descriptors, unsupported-state UI, runtime-specific
settings, and a future cloud-extension contract stub only if evidence requires metadata.

## Tasks

### AS05-C-01 — Audit capability behavior

Test read-only/ask, workspace-write, permissions, tools, fork/lifecycle,
catalogs, usage, and restore against the pinned SDK.

**Acceptance:** A capability ledger records supported, unsupported, conditional, and unknown behavior with evidence.

### AS05-C-02 — Map supported controls

Expose validated runtime/model/mode and other supported controls through common
capabilities or an adapter extension.

**Acceptance:** Creation and session actions never offer an invalid or silently ignored option.

### AS05-C-03 — Gate unsupported controls

Hide or explain unsupported read-only, permission, fork, checkpoint, and
lifecycle behavior; do not emulate any of it through system prompts.

**Acceptance:** Unsupported capability fixtures produce no outbound no-op request.

### AS05-C-04 — Preserve cloud deferral boundary

If the SDK exposes cloud metadata, model it as runtime-specific descriptor data
without adding execution, routing, persistence, or a top-level Cloud context.

**Acceptance:** Active product navigation remains workspace Sessions only; future cloud work has a clear extension point.

## Verification

- Run capability-ledger, descriptor and UI-state tests.
- Compare every advertised action to observed SDK behavior.
- Search active UI/state for a standalone Cloud context.

## Handoff

Phase D starts when the capability ledger is reviewed and no unknown behavior is advertised.
