# 03 — Phase B: early installed build, diagnostics and recovery

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS01-S for packaging design/build work; AS02-B for native Codex runtime smoke. No dependency on handoff A, observability B or later adapters.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Ship the first usable Codex preview from an installed app outside the development checkout.

## Implementation boundary

Own reproducible host/Node assets, native runtime distribution/discovery, support diagnostics and installed recovery/version checks. Later adapter native assets extend this gate when each is enabled.

## Tasks

### AS03-B-01 — Package host and compatible Node

Build deterministic host metadata/artifacts from pinned source/version inputs. Wire host build/resources into Tauri release pipeline; bundle tested Node, signing/permissions and target assets. Keep an explicit development override independent of normal installed resolution.

**Acceptance:** Installed macOS app launches correct host/Node outside checkout and without developer PATH. Same inputs produce reproducible host identity; wall-clock build metadata does not undermine the claim.

### AS03-B-02 — Define native runtime distribution and setup

Choose bundled/installed Codex only where permitted or explicit user-managed executable with supported-version validation and setup UX. Validate custom executable override; add native SDK assets for future adapters when they are enabled.

**Acceptance:** Missing/incompatible native runtime gives actionable setup while editor/other healthy runtime work remains available. Node is bundled; vendor runtime management mode is documented, not silently inferred from PATH.

### AS03-B-03 — Expose useful safe diagnostics

Report host/native versions, profile ID/nonsecret auth category, generation, health and recent typed errors. Provide bounded allowlisted support export, excluding auth files, tokens, device codes/auth URL query and raw tool output by default.

**Acceptance:** Canaries never enter copy/export/log payloads. A user can diagnose missing runtime, mismatch, auth-required, offline and crash state without exporting native home or internal debug data.

### AS03-B-04 — Implement installed recovery UX

Offer scoped retry/re-auth/restart for missing binary, expired auth, quota, child crash, whole-host crash loop and mismatch. Explain interrupted turn/history. Never retry sent prompt or replace thread automatically; preserve binding and workspace files.

**Acceptance:** Child recovery targets selected profile, whole-host recovery settles its affected sessions; neither deletes files/another profile or silently rotates accounts. Quota/unknown limits are distinguished.

### AS03-B-05 — Verify component compatibility and installed lifecycle

Test Tauri/host/native version compatibility, stale overrides, interrupted component update and supported binary replacement. Do not implement persisted-data upgrade/downgrade migration. Record install/start/auth/tool/cancel/restart/quit evidence on first target and extend per later target.

**Acceptance:** Incompatible binaries fail before session work with a supported recovery path. Installed macOS smoke leaves no descendants and has no checkout/Node-on-PATH dependency.

## Verification

- Run reproducibility, resource inclusion/resolver, support-canary and recovery-state fixtures.
- Build/install first macOS preview; launch from a normal environment outside checkout and inspect process tree.
- Record component support/distribution matrix; future native assets/platforms are checked before advertisement.

## Exit and next work

03-B plus independent 03-A and Codex 02-C unlocks 02-D. Selected-scope 08-A decides each release; handoff and remaining vendor adapters never block this early gate. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
