# 02 — Phase C: native configuration, limits and history reconciliation

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS02-B accepted.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Make Codex state, capabilities and resumed history reliable enough for everyday use.

## Implementation boundary

Own profile-scoped account/limits, advanced configuration ledger, full native/cache reconciliation and capability UX. Basic resume/settings are already required by B; later simultaneous profiles are 06-C.

## Tasks

### AS02-C-01 — Finalize native configuration and feature ledger

Enumerate workspace instructions, profile config, skills, MCP/plugins, hooks/subagents, native plans and supported native actions against pinned runtime. Record separate native execution, UI display and UI configuration status, tests and explicit deferrals.

**Acceptance:** Every advertised feature has evidence; unsupported/experimental capabilities are absent by default. New profile config scope is visible and workspace instructions are consumed by native harness.

### AS02-C-02 — Integrate settings and capability extensions

Extend B settings/catalog using supported effort, collaboration, sandbox, approval policy and native extension panels. Include scope and experimental opt-in where required. Do not add vendor types to common UI or mandatory methods for optional features.

**Acceptance:** Supported combinations round-trip and reach native config; profile/global/workspace settings do not silently override one another. Common UI works with optional extensions absent.

### AS02-C-03 — Map profile account usage and rate limits

Read account/usage/rate-limit state and merge sparse updates by profile/limit identity. Expose quota/auth-expiry/offline states with explicit retry/re-auth. Logout invalidates only that profile and marks its sessions auth-required.

**Acceptance:** Temporary missing limit data does not disable healthy work. Profile B auth/limits do not affect A or another profile; no automatic account rotation or hidden retry follows quota failure.

### AS02-C-04 — Reconcile native history and cache

Hydrate/read/resume by stable native item/turn IDs and normalized cursors. Handle sparse snapshots, partial turns, missing/divergent cache, duplicates, event reordering and interrupted restart. Native history wins, local metadata/lineage remains intact.

**Acceptance:** Restart during/after a turn yields no duplicate completed item; cache cannot overwrite native truth or replay prompt. Missing native history is explicit and preserves SpecOps record.

### AS02-C-05 — Verify capabilities, cache and recovery states

Add configuration/scope/conditional capability fixtures, sparse limits, logout/expiry, replay/reordering, stale generations, corrupt cache and missing-thread cases. Hand version/setup details to 03-B and activity semantics to 03-A.

**Acceptance:** Feature ledger has no advertised unknown behavior. Profile failure is recoverable, unrelated editor/workspace/session state remains usable, and C evidence is ready for D.

## Verification

- Run capability/settings, profile-account/limits, reconciliation and recovery UI tests.
- Compare each advertised control with pinned executable/schema/native behavior.
- Record restart during/after a turn and missing-native-history behavior.

## Exit and next work

D begins after C and early 03-A/03-B gates pass; full profile-to-profile concurrency may ship later in 06-C. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
