# 07 — Phase A: feasibility, auth and installed SDK bootstrap

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS02-D plus accepted shared contract/profile/03-A/03-B infrastructure. Default stage 07 after initial integrations; handoff is not a technical prerequisite.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Verify the current official local SDK before promising a Cursor adapter.

## Implementation boundary

Own native SDK/auth/capability/asset feasibility spike then pinned bootstrap/profile state. Cloud execution is excluded.

## Tasks

### AS07-A-01 — Verify and pin native SDK feasibility

Probe current official SDK local mode: runtime loop, native durable history store, stream/cancel, native policy/hook enforcement and unsupported interaction behavior. Record exact Node/OS/native asset/version and bundling requirements. Choose supported SDK entry/storage for the actual host packaging; do not assume a single JS file contains native binaries.

**Acceptance:** Written feasibility ledger and installed native-asset probe identify viable local path and unknowns. Pin tested version before implementation; unsupported semantics are not promised.

### AS07-A-02 — Implement current supported profile authentication

Use supported user/service API keys through host credential boundary. Evaluate official browser-assisted login and its minted credential storage/current third-party embedding support before exposing it. Keep selected profile/environment, login progress and logout independent from other runtime accounts.

**Acceptance:** Profile-local auth/status/probe/logout works; no keys/tokens/native auth files enter frontend state/logs/errors/export; unsupported flow has explicit capability state.

### AS07-A-03 — Expose actual catalog and runtime support state

Read supported models/settings using selected profile; separate model/options/native sandbox/tool control rather than assuming generic mode. Document actual release maturity/version instead of permanently labeling every version beta.

**Acceptance:** Loading/offline/auth/missing-native-asset/unsupported states are distinct; no HTTP model wrapper or generic provider fallback replaces native harness.

### AS07-A-04 — Bootstrap tests

Cover missing SDK/runtime, unsupported version, auth variants, redaction,
catalog refresh, and adapter-local offline state.

**Acceptance:** Automated tests use fixtures; real-key probe is manually gated.

## Verification

- Run adapter/profile/schema/mapper and capability fixtures appropriate to this phase, using no live credential by default.
- Check error/log/transcript/export boundaries with canaries and late profile/generation events.
- Record pinned native contracts and optional real-runtime/installed smoke for the advertised support scope.

## Exit and next work

B follows proven local SDK/installed-assets feasibility and stable authenticated profile/catalog; record blocked native assumptions instead of implementing prompt emulation. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
