# 05 — Phase A: SDK bootstrap, auth, health and catalogs

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisites:** Milestones 01–04 Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Load the pinned local SDK in Agent Host and expose honest runtime/auth/catalog state.

## Agent handoff boundary

Own SDK packaging, version/health, user/service-account API-key flow, model/mode
catalogs, and bootstrap tests. Agent/run lifecycle belongs to Phase B.

## Tasks

### AS05-A-01 — Pin and package the beta SDK

Add a tested SDK version inside Agent Host, record compatibility/licensing and
runtime requirements, and isolate all imports to the adapter.

**Acceptance:** Packaged host discovers the adapter and reports exact SDK/beta version independently.

### AS05-A-02 — Implement supported API-key auth

Route user/service-account keys through the credential boundary with status,
probe, invalid/expired handling, logout/clear, and redaction.

**Acceptance:** Keys never enter frontend state, logs, snapshots, transcripts, or diagnostic export.

### AS05-A-03 — Map health, models and modes

Read actual catalogs/availability from the SDK, normalize stable ids/labels,
and expose loading/offline/unsupported/beta states.

**Acceptance:** No generic HTTP-provider key or catalog fallback is used.

### AS05-A-04 — Bootstrap tests

Cover missing SDK/runtime, unsupported version, auth variants, redaction,
catalog refresh, and adapter-local offline state.

**Acceptance:** Automated tests use fixtures; real-key probe is manually gated.

## Verification

- Run host build, adapter bootstrap, auth/redaction, descriptor and catalog tests.
- Inspect diagnostic fixtures using secret canaries.
- Perform an optional gated auth/catalog probe.

## Handoff

Phase B starts when the adapter is healthy, authenticated, and reports stable catalogs.
