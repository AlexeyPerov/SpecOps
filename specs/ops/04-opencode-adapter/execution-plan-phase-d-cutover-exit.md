# 04 — Phase D: legacy cutover, fixture comparison and milestone exit

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisites:** Phases A–C Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Remove the legacy path and prove the host adapter is ready for broad Sessions beta.

## Agent handoff boundary

Own final parity review, legacy deletion, clean persistence cutover, packaging,
cross-runtime regression, docs, and status updates. Do not add deferred features.

## Tasks

### AS04-D-01 — Final legacy/new comparison

Run recorded fixtures and manual checklist across core and retained extensions;
resolve or explicitly document every difference.

**Acceptance:** Reviewed parity/deferred ledger contains no unknown or unowned row.

### AS04-D-02 — Remove legacy frontend and supervisor paths

Delete direct SDK/client imports, provider-specific Rust supervisor, old feature
gate branches, obsolete stores/codecs, and dead tests/configuration.

**Acceptance:** Build/search confirms one Agent Host path and no provider SDK in the frontend bundle.

### AS04-D-03 — Clean-store and packaging verification

Verify no legacy persistence migration, supported runtime resolution, updater
compatibility, launch/restart/shutdown, and process-tree cleanup on supported platforms.

**Acceptance:** Fresh store behavior is documented and packaging smoke leaves no orphan processes.

### AS04-D-04 — Cross-runtime regression and closure

Run all three adapters together, offline one at a time, test independent resume,
update docs/changelog/statuses, and decide broad-beta enablement.

**Acceptance:** One runtime failure never disables another; milestone README definition of done passes.

## Verification

- Run full Sessions, adapter, frontend, Rust and packaging suites.
- Search for direct SDK imports, old supervisor commands, and legacy session fields.
- Complete supported-platform smoke matrix.

## Handoff

Mark milestone 04 Done and enable broad beta only if the documented gate passes;
then assign phase 05.
