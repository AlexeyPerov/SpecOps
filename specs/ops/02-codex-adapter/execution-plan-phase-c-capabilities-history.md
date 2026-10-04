# 02 — Phase C: native configuration, limits and history reconciliation

**Date:** 2026-10-04

**Status:** Implemented and fixture-verified for the explicitly opted experimental legacy-history source slice; authenticated/installed acceptance and unsupported paginated hydration remain open.

**Evidence:** [Implementation and pinned feature ledger](implementation-notes-phase-c.md).

**Prerequisites:** AS02-B accepted.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Make Codex state, capabilities and resumed history reliable enough for everyday use.

## Implementation boundary

Own profile-scoped account/limits, advanced configuration ledger, full native/cache reconciliation and capability UX. Basic resume/settings are already required by B; later simultaneous profiles are 06-C.

## Tasks

### [DONE — supported source scope] AS02-C-01 — Finalize native configuration and feature ledger

Enumerate workspace instructions, profile config, skills, MCP/plugins, hooks/subagents, native plans and supported native actions against pinned runtime. Record separate native execution, UI display and UI configuration status, tests and explicit deferrals.

**Acceptance:** Every advertised feature has evidence; unsupported/experimental capabilities are absent by default. New profile config scope is visible and workspace instructions are consumed by native harness.

### [DONE — supported source scope] AS02-C-02 — Integrate settings and capability extensions

Extend B settings/catalog using supported effort, collaboration, sandbox, approval policy and native extension panels. Include scope and experimental opt-in where required. Do not add vendor types to common UI or mandatory methods for optional features.

**Acceptance:** Supported combinations round-trip and reach native config; profile/global/workspace settings do not silently override one another. Common UI works with optional extensions absent.

### [DONE — supported source scope] AS02-C-03 — Map profile account usage and rate limits

Read account/usage/rate-limit state and merge sparse updates by profile/limit identity. Expose quota/auth-expiry/offline states with explicit retry/re-auth. Logout invalidates only that profile and marks its sessions auth-required.

**Acceptance:** Temporary missing limit data does not disable healthy work. Profile B auth/limits do not affect A or another profile; no automatic account rotation or hidden retry follows quota failure.

### [DONE — supported source scope] AS02-C-04 — Reconcile native history and cache

Hydrate/read/resume by stable native item/turn IDs and normalized cursors. Handle sparse snapshots, partial turns, missing/divergent cache, duplicates, event reordering and interrupted restart. Native history wins, local metadata/lineage remains intact.

**Acceptance:** Restart during/after a turn yields no duplicate completed item; cache cannot overwrite native truth or replay prompt. Missing native history is explicit and preserves SpecOps record.

### [DONE — supported source scope] AS02-C-05 — Verify capabilities, cache and recovery states

Add configuration/scope/conditional capability fixtures, sparse limits, logout/expiry, replay/reordering, stale generations, corrupt cache and missing-thread cases. Hand version/setup details to 03-B and activity semantics to 03-A.

**Acceptance:** Feature ledger has no advertised unknown behavior. Profile failure is recoverable, unrelated editor/workspace/session state remains usable, and C evidence is ready for D.

## Verification

- Run capability/settings, profile-account/limits, reconciliation and recovery UI tests.
- Compare each advertised control with pinned executable/schema/native behavior.
- Record restart during/after a turn and missing-native-history behavior.

## Exit and next work

D begins after C and early 03-A/03-B gates pass; full profile-to-profile concurrency may ship later in 06-C. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.

## Recorded support boundary

C keeps the persisted profile experimental gate default off. Optional neutral session configuration, profile account/limits/recovery, composite host/child generation guards and full materialized-legacy native/cache reconciliation are implemented and tested. Sparse legacy or paginated snapshots fail explicitly with cache preserved because the pinned executable lacks `thread/items/list`; no unsupported method, replacement thread or prompt replay is attempted. Native-owned skill/MCP/plugin/hook/subagent configuration and management panels are explicitly deferred in the ledger. These source dispositions do not close real account-B, native instruction/extension execution, whole-host UI smoke or installed gates required by D + 03-A/B.
