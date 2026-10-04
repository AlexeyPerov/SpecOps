# 04 — Phase A: legacy inventory and new host ownership

**Date:** 2026-10-04

**Status:** Source implementation verified; external acceptance open

**Evidence:** [Bootstrap and finite parity ledger](implementation-notes-phase-a.md)

**Prerequisites:** AS02-D accepted baseline and AS01-S. No Claude prerequisite.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Establish a single-owner host adapter path and finite parity scope for the second runtime.

## Implementation boundary

Own inventory/ledger, host client/profile/auth and runtime bootstrap. Keep legacy code only as a temporary parity reference until core cutover 04-C; do not demand optional extensions before cutover.

## Tasks

### [DONE source] AS04-A-01 — Inventory ownership and establish parity/deferred ledger

Map frontend SDK/client, Rust sidecar, process/config/auth/start/shutdown and existing behavior. Classify every legacy UI category as core required for 04-C, retained later 06-B or deferred with rationale/owner. Include fork/revert/share/summarize, commands/search, todos/diffs/file status/language services, provider models/auth/config, MCP/skills/agents.

**Acceptance:** Every legacy category is owned and scoped; 04-C has a finite core gate. A retained code file is not proof that the feature works in new Sessions.

### [DONE source] AS04-A-02 — Add host-side SDK and profile configuration

Pin SDK/runtime and place client imports inside Agent Host. Bootstrap supported provider/config auth through host-owned profile scope; adapt common profile/catalog/health control plane. Legacy frontend dependency may temporarily remain as reference and is removed in 04-C.

**Acceptance:** New host connection/probe uses no SDK in common UI and contains no frontend secret state. Same profile/runtime settings survive restart; external endpoint/local ownership is explicit.

### [DONE source] AS04-A-03 — Transfer native lifecycle ownership

Host launches/connects, monitors, restarts and stops native runtime; Tauri owns only Agent Host on the new path. Exclusive old/new gate chooses one runtime owner, with clear temporary parity-only legacy usage.

**Acceptance:** No double launch or simultaneous supervisor ownership in any intermediate gate state; new-path shutdown/crash leaves no descendants.

### [DONE source] AS04-A-04 — Verify bootstrap and pin cutover baseline

Cover binary/version/PATH override, auth/config/connection failure, port ownership, profile collisions, stale generations, crash/restart/shutdown and gate selection. Record core fixture corpus and 06-B deferments.

**Acceptance:** Process/auth/profile tests are deterministic; Codex remains healthy when this runtime is offline. Core/deferred ledger is ready for B and 04-C.

## Verification

- Run host bootstrap/auth/redaction and runtime-owner/process-tree fixtures.
- Compare discovery/catalog/config/profile state with native behavior and legacy fixture corpus.
- Verify gate switches leave only one native owner.

## Exit and next work

B follows A; 04-C follows B without waiting for optional 06-B. The finite ledger is maintained throughout cutover. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.

## Acceptance remaining

Pinned bundled native no-account bootstrap and deterministic host/process/profile checks passed. Upstream AS02-D installed/live-account baseline is not accepted; installed gate switching, provider inference/account separation, platform packaging and immediate descendant-exit race remain open. Source completion permits B implementation without claiming accepted runtime delivery.
