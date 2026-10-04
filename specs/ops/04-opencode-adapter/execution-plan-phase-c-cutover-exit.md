# 04 — Phase C: core cutover and second-runtime acceptance

**Date:** 2026-10-04

**Status:** Source cutover verified; installed/account/release acceptance open

**Prerequisites:** AS04-A/AS04-B accepted; early AS03-A/AS03-B extended for OpenCode.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Remove legacy execution paths once core parity is verified and release the second runtime.

## Implementation boundary

Own core comparison, legacy frontend/supervisor deletion, clean storage behavior, installed build and Codex/OpenCode acceptance. Do not pull all rich extensions into this gate.

## Tasks

### [DONE — source] AS04-C-01 — Review finite core cutover ledger

Verify core parity and intentional corrections. For later 06-B features publish unavailable/deferred status, target task, rationale and owner; distinguish native functionality from removed frontend surface.

**Acceptance:** Core has no unresolved required difference. Deferred feature visibility is honest, and no claim of full legacy feature parity gates this release.

### [DONE — source] AS04-C-02 — Remove direct frontend and old supervisor paths

Delete frontend vendor SDK/client imports, legacy execution branches, provider-specific Rust supervisor ownership and obsolete stores/codecs/tests/settings gate. Keep only new host adapter path and rich-feature reference evidence needed by 06-B.

**Acceptance:** No vendor SDK import remains in WebView bundle and no legacy runtime launcher competes with host. Sessions enablement is neutral; retained native extension code stays host-side.

### [SOURCE VERIFIED — acceptance open] AS04-C-03 — Verify clean-store and installed runtime lifecycle

No persisted-state migration. Extend 03-B installed resolution/native assets/versions and support diagnostics; test init/auth/tools/cancel/restart/quit and descendants for supported OpenCode targets.

**Acceptance:** Installed native core works outside checkout; removed legacy state does not get silently imported. Release docs explain reset and deferred extensions; no orphans remain.

### [SOURCE VERIFIED — acceptance open] AS04-C-04 — Accept Codex/OpenCode coexistence and record baseline

Exercise independent auth/profile/offline/history plus concurrent writers and repeated host recovery; run applicable regression/type/build checks. Record 04-C baseline and selected-scope 08-A release; leave 06-B Planned.

**Acceptance:** Second-runtime baseline passes without Claude/Cursor/handoff. Healthy runtime stays usable after the other child fails; whole-host failure settles both. 06-B is not falsely marked Done.

## Verification

- Run core contract, profile/cache/security, frontend import/legacy-supervisor absence checks and installed lifecycle smoke.
- Run Codex/OpenCode coexistence, writer warnings and external-file refresh.
- Review core/deferred ledger and selected-scope release evidence.

## Exit and next work

Accepted 04-C unblocks scheduled Claude work and technically enables handoff. Later 06-B retains a separate acceptance gate. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.

Implementation and outstanding installed/live gates: [04-C evidence](implementation-notes-phase-c.md). Source cutover permits subsequent implementation; acceptance is not closed.
