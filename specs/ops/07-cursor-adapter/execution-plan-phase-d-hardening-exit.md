# 07 — Phase D: installed native acceptance and release extension

**Date:** 2026-10-04

**Status:** Source fault/security/coexistence/handoff verified; authenticated native and signed installed acceptance open.

**Prerequisites:** AS07-A/AS07-B/AS07-C accepted; early 03-A/03-B extended for this SDK/native assets.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Accept independently usable Cursor with truthful native limitations.

## Implementation boundary

Own native SDK/asset fault/security/coexistence and installed support evidence; cloud execution remains out of scope.

## Tasks

### AS07-D-01 [DONE: selected source] — Run SDK/profile fault recovery matrix

Cover missing SDK/asset/incompatible version, offline/expired auth/quota, native store loss, stream disconnect, child/host crash, cancellation race and restart.

**Acceptance:** Typed recovery preserves profile/binding/files; no fabricated history or silent cross-account retry. Healthy enabled runtime remains available after this runtime failure.

### AS07-D-02 [DONE: selected source] — Security and redaction audit

Run secret canaries through auth, errors, raw SDK events, transcript cache,
logs, snapshots, and diagnostic export. Include profile identity, inherited auth environment, native credential storage and control-plane notifications.

**Acceptance:** No canary crosses a prohibited boundary. Unrelated profiles remain intact.

### AS07-D-03 [OPEN: source contract/copy probe verified; installed/native account pending] — Verify shared contract and installed native smoke

Run supported-subset shared contract and actual credential create/tool/follow-up/cancel/reconnect/config smoke in installed build. Include native assets/sandbox/search/storage packaging and current auth method scope.

**Acceptance:** Matrix records native capabilities and limits accurately on advertised platforms; no developer PATH/storage dependency passes as installed readiness.

### AS07-D-04 [DONE: source docs/16-pair extension; release acceptance open] — Close adapter and rerun selected release matrix

Document setup/auth/native feature/config/history/asset/version support, limitations/recovery and cloud non-scope. Update changelog/statuses and extend 06-A pairwise tests only if handoff is advertised.

**Acceptance:** Cursor baseline acceptance extends selected 08-A release record; final roadmap closure remains separate and includes all open active scope.

## Verification

- Run adapter/profile/schema/mapper and capability fixtures appropriate to this phase, using no live credential by default.
- Check error/log/transcript/export boundaries with canaries and late profile/generation events.
- Record pinned native contracts and optional real-runtime/installed smoke for the advertised support scope.

## Exit and next work

Record Cursor acceptance, then run expanded 08-A release gate. Do not delay previous subset releases or automatically close roadmap. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.

## Recorded source evidence

[AS07-D implementation/support/fault notes](implementation-notes-phase-d.md) · [Selected source release baseline](../08-release-gates/baseline-07-d.md). Actual authenticated/signed installed/platform/distribution gates remain open; these records do not close the roadmap.
