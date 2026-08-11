# 06 — Phase C: packaging, health, diagnostics and recovery

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisites:** Phases A and B Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Package a compatible host/runtime set and make failures actionable without exposing secrets.

## Agent handoff boundary

Own supported-target packaging, runtime resolution/version diagnostics, support
bundle, updater compatibility, and recovery UI. Final release matrix belongs to Phase D.

## Tasks

### AS06-C-01 — Package Agent Host per target

Produce deterministic host artifacts, include required Node/runtime assets, and
verify executable resolution/signing/permissions in development and release bundles.

**Acceptance:** Every supported target launches the exact host version expected by Tauri.

### AS06-C-02 — Define runtime distribution and overrides

Bundle/install vendor runtimes only where redistribution permits; otherwise
provide discovery/setup and explicit PATH override with version validation.

**Acceptance:** Missing/incompatible runtimes fail with actionable setup guidance and do not affect healthy adapters.

### AS06-C-03 — Build health and support diagnostics

Expose host/adapter/runtime versions, auth category, health, recent typed errors,
and process generation; generate a copyable redacted support bundle.

**Acceptance:** Secret canaries and raw tool output are absent; bundle is useful without internal debug mode.

### AS06-C-04 — Recovery UX and crash-loop behavior

Handle offline, missing binary, expired auth, quota/rate limit, crash loop,
protocol mismatch, updater mismatch, retry, re-auth, and reset actions.

**Acceptance:** Recovery is scoped to the failing runtime and never deletes workspace files or unrelated sessions.

### AS06-C-05 — Updater compatibility checks

Define compatible Tauri/host/runtime version ranges and verify upgrade,
downgrade, interrupted update, and stale PATH override behavior.

**Acceptance:** Incompatible pairs fail before session work begins and provide a supported recovery path.

## Verification

- Build/package on every supported target or CI image.
- Run support-bundle canary/redaction and recovery-state tests.
- Exercise compatible/incompatible update fixtures.

## Handoff

Phase D starts when release artifacts can diagnose and recover every defined runtime failure class.
