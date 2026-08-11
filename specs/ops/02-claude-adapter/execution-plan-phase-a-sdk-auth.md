# 02 — Phase A: SDK bootstrap, authentication and runtime descriptor

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisite:** Milestone 01 Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Load the pinned SDK in Agent Host and expose honest auth/health/catalog state.

## Agent handoff boundary

Own SDK packaging, adapter bootstrap, credentials, descriptor, health, and
catalogs. Do not implement live session streaming beyond a connection probe.

## Tasks

### AS02-A-01 — Pin and package the SDK

Add the official TypeScript SDK to Agent Host, pin its version, record runtime
compatibility, and keep all SDK imports inside the adapter module.

**Acceptance:** Packaged host discovers the adapter and reports exact SDK/runtime versions.

### AS02-A-02 — Implement credential flow

Support API key and officially supported cloud-provider credentials through the
host credential boundary; implement authenticate, status, refresh/probe, and logout semantics.

**Acceptance:** No credential enters frontend stores, snapshots, transcripts,
logs, errors, or diagnostics.

### AS02-A-03 — Map descriptor, health and catalogs

Report runtime availability, auth requirements, supported setting sources,
models/modes when discoverable, beta/version state, and capability prerequisites.

**Acceptance:** Offline, missing credential, invalid credential, and healthy states are distinct.

### AS02-A-04 — Adapter bootstrap tests

Cover missing SDK/runtime, auth failures, redaction, descriptor stability, and
catalog normalization with fakes/fixtures.

**Acceptance:** Phase A tests run without real credentials; real connection probe is manually gated.

## Verification

- Run host build, adapter bootstrap, auth/redaction and descriptor tests.
- Inspect frontend state and diagnostic fixtures with secret canaries.
- Perform optional manually gated authentication probe.

## Handoff

Phase B starts when a healthy authenticated adapter can be selected by the host
and reports stable model/mode metadata.
