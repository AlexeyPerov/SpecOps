# 02 — Phase B: profile-bound native sessions and events

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS02-A accepted.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Deliver native create/send/cancel/history through the shared contract.

## Implementation boundary

Own SDK/native lifecycle and deterministic event mapping; optional interactions/config extensions are completed in C before release.

## Tasks

### AS02-B-01 — Create profile-bound native sessions

Use real workspace cwd, explicit supported native setting sources and host-owned profile context. Capture native session ID and persist runtime/profile/settings binding through production writer.

**Acceptance:** Two sessions retain independent native IDs/profiles and settings after fresh app/host state.

### AS02-B-02 — Normalize native turn events

Map initialization, assistant text/reasoning, tools/results, usage/cost/errors and bounded unknown native events with native IDs, host cursor and profile/turn/generation correlation.

**Acceptance:** Each stream reaches exactly one terminal and iterator completes; stale events never target another profile/runtime.

### AS02-B-03 — Resume and supported native lifecycle

Resume history under the same profile; fork only via native capability if supported. Missing/interrupted history stays explicit and preserves local metadata.

**Acceptance:** Fresh-process app restart continues same native session; no hidden new session, prompt replay or in-place account/runtime switch.

### AS02-B-04 — Cancellation and lifecycle fixtures

Map abort/cancel, distinguish user cancellation from failure, and add recorded
fixtures for success, tool use, failure, interruption, resume, and cancellation.

**Acceptance:** Cancel settles the active turn once and leaves the session reusable when supported.

## Verification

- Run adapter/profile/schema/mapper and capability fixtures appropriate to this phase, using no live credential by default.
- Check error/log/transcript/export boundaries with canaries and late profile/generation events.
- Record pinned native contracts and optional real-runtime/installed smoke for the advertised support scope.

## Exit and next work

C follows lifecycle acceptance; B is a developer slice, not usable-release acceptance before native interactions pass. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
