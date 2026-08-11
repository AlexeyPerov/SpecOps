# 01 — Phase A: remove Chat and dormant Cloud surfaces

**Date:** 2026-08-11  
**Status:** Planned  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Remove obsolete product lanes while preserving reusable Sessions rendering.

## Agent handoff boundary

Own the complete removal of standalone Chat/Cloud UI, routing, state, settings,
and persistence. Do not redesign the new session domain; Phase B owns it.

## Tasks

### AS01-A-01 — Characterize removal surface

Inventory context ids, rail items, routes, settings, stores, codecs, commands,
tests, and docs tied to `chat-http` or dormant Cloud behavior. Identify generic
message/tool/composer components that Sessions still needs.

**Acceptance:** A checked removal list exists in the implementation notes;
reusable components are explicitly separated from product-specific state.

### AS01-A-02 — Remove product UI and routing

Delete Chat/Cloud rail entries, pages, restore routing, beta gates, composer
routing, and Chat-only modes. Remove dead imports and product-visible strings.

**Acceptance:** No UI path can create or open these contexts; Notepad and
workspace navigation continue to work.

### AS01-A-03 — Remove settings, runtime and persisted fields

Delete HTTP connection/provider settings, API-key fields, runtime code, store
state, snapshots, and codecs used only by Chat/Cloud. Do not add migration or
compatibility branches.

**Acceptance:** Fresh settings/session state contains no removed fields and old
AI data is ignored or reset according to repository policy.

### AS01-A-04 — Close tests and docs

Delete obsolete tests; retain or rewrite characterization coverage for reused
rendering. Update architecture, README, feature flags, and changelog.

**Acceptance:** Search finds no active Chat/Cloud product contract; relevant
frontend/domain suites pass.

## Verification

- Search active code/docs for removed context ids and settings keys.
- Exercise cold start, workspace restore, Notepad, editor, and version control.
- Run affected frontend and persistence tests plus type checking.

## Handoff

Mark Phase A Done only when the removed lanes cannot be restored from active
state. Phase B then introduces the clean session schema.
