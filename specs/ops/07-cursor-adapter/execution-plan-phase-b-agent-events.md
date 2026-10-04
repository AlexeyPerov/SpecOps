# 07 — Phase B: durable native agents, runs and recovery

**Date:** 2026-10-04

**Status:** Source implementation verified; authenticated/installed acceptance remains open.

**Prerequisites:** AS07-A accepted.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Deliver profile-bound local native sessions/runs and follow-up.

## Implementation boundary

Own native agent/run storage/stream/tool/status/usage, cancel and same-profile reconnect; capability gaps belong to C.

## Tasks

### AS07-B-01 — Create profile-bound durable native agents

Use native SDK local runtime with workspace rootPath, tested history store, selected settings and immutable runtime/profile/agent binding. Native run IDs remain turn-scoped, not replacement session identity.

**Acceptance:** Multiple sessions retain native IDs and durable history under the correct profile; no frontend native store or user-state migration.

### AS07-B-02 — Normalize native stream and terminal state

Map native text/reasoning/tools/changes/usage/status/errors and bounded unknown events; use native IDs plus host cursor/profile/generation.

**Acceptance:** Each run terminates once and iterator closes; failed/cancelled are distinct, and events cannot route to another profile.

### AS07-B-03 — Follow up and restore native history

Use native subsequent prompt and supported reconnect/resume with persistent store after app/host restart. If pinned SDK does not support a requested lifecycle, expose explicit limitation rather than fabricating continuity.

**Acceptance:** Same-profile native history is resumed where supported; missing history preserves local metadata and never silently sends old prompt again.

### AS07-B-04 — Cancellation and lifecycle fixtures

Map cancel semantics and record success, tools, usage, reconnect, failure,
cancellation, and missing-history cases.

**Acceptance:** Shared adapter lifecycle contract passes with documented exceptions only where capability says unsupported.

## Verification

- Run adapter/profile/schema/mapper and capability fixtures appropriate to this phase, using no live credential by default.
- Check error/log/transcript/export boundaries with canaries and late profile/generation events.
- Record pinned native contracts and optional real-runtime/installed smoke for the advertised support scope.

## Exit and next work

C follows local native lifecycle evidence; actual supported restart scope is recorded before release. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.

## Recorded source evidence

AS07-B-01 through B-04 are implemented and source verified for the minimal no-tool local scope. See [implementation notes](implementation-notes-phase-b.md) for pinned SDK contracts, native store/wire fixtures, production cache recovery, cancellation and uncertainty boundaries. Actual authenticated native history/stream/tool/cancel and installed gates remain open in the [selected release baseline](../08-release-gates/baseline-07-b.md). C follows this source lifecycle; B is not full release acceptance.
