# 02 — Phase A: native SDK, current auth policy and connection profiles

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS03-D and scheduled AS04-D baseline accepted; AS01-S and early 06-B/C available. An explicitly recorded slots-4/5 swap may place Claude after Codex directly.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Bootstrap the third scheduled native harness with current supported auth and independent profile state.

## Implementation boundary

Own pinned SDK/native binary, profile/credential auth, descriptor/catalog/settings scope. Native turns belong to B.

## Tasks

### AS02-A-01 — Pin the native SDK and verify installed assets

Use the official native Agent SDK, not a model client SDK. Record version, native binary/Node/OS assets, licensing and shared host bundling compatibility. Extend 06-C resolver/native-asset checks without adding frontend SDK imports.

**Acceptance:** Installed host discovers exact supported SDK/native versions; missing/incompatible dependencies are runtime-local and actionable.

### AS02-A-02 — Recheck auth policy and implement profile connection

Record current official supported third-party embedding/auth documentation before coding. Baseline is API key or supported cloud credentials through host-owned profile; add subscription login only with documented allowed/supported flow and actual pinned-version evidence. Scope environment/native settings to selected profile; no inherited account fallback.

**Acceptance:** Auth lifecycle, refresh/status/logout and stale completion rules are profile-local. Secrets stay outside frontend/logs/snapshots/errors/export; unsupported login is explained, not simulated.

### AS02-A-03 — Map profile descriptor and honest catalogs

Report version/health/auth and native configuration sources. Normalize discoverable models and distinct native policy/tool/budget settings; no hard-coded claims of subscription/model entitlement.

**Acceptance:** Missing/offline/auth-invalid/healthy states differ; another profile/runtime remains usable and unknown capabilities are unadvertised.

### AS02-A-04 — Adapter bootstrap tests

Cover missing SDK/runtime, auth failures, redaction, descriptor stability, and
catalog normalization with fakes/fixtures.

**Acceptance:** Phase A tests run without real credentials; real connection probe is manually gated.

## Verification

- Run adapter/profile/schema/mapper and capability fixtures appropriate to this phase, using no live credential by default.
- Check error/log/transcript/export boundaries with canaries and late profile/generation events.
- Record pinned native contracts and optional real-runtime/installed smoke for the advertised support scope.

## Exit and next work

B follows authenticated A; Claude has no role as a Codex prerequisite. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
