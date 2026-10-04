# 05 — Phase D: installed recovery, security and baseline acceptance

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS05-A/AS05-B/AS05-C accepted; early 03-A/03-B extended for Claude.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Accept Claude without delaying existing Codex/OpenCode releases.

## Implementation boundary

Own fault/security/installed coexistence checks, current auth scope and docs; do not reopen predecessor gates for unrelated features.

## Tasks

### AS05-D-01 — Run profile/runtime recovery matrix

Cover missing SDK/binary, offline/invalid/expired auth, quota/rate errors, exception/stream disconnect, child/host crash, cancel race, missing history and fresh-process restart.

**Acceptance:** Failure is actionable and scoped correctly; no prompt replay/native replacement/account rotation; whole-host failure settles affected streams.

### AS05-D-02 — Security and redaction audit

Run secret canaries through auth, errors, raw events, transcript caching, logs,
snapshots, handoff-ready summaries, and diagnostic export. Include profile identity, inherited auth environment, native credential storage and control-plane notifications.

**Acceptance:** No canary crosses a prohibited boundary. Unrelated profiles remain intact.

### AS05-D-03 — Verify native contract and installed credential smoke

Run strengthened contract and optional actual-credential create/tool/allow/deny/input/cancel/resume/logout smoke from installed build; document supported auth families and actual native feature ledger.

**Acceptance:** Recorded installed-platform evidence passes without exposing secrets; Codex/OpenCode independence is checked when enabled.

### AS05-D-04 — Close Claude baseline and update subset release

Document current setup/auth/policy evidence, config/native feature scope, limits/recovery and writer visibility. Update task/phase/milestone states and changelog and rerun selected-scope 08-A.

**Acceptance:** Accepted Claude extends release scope; already shipped runtimes remain usable and no task claims Codex depends on this adapter.

## Verification

- Run adapter/profile/schema/mapper and capability fixtures appropriate to this phase, using no live credential by default.
- Check error/log/transcript/export boundaries with canaries and late profile/generation events.
- Record pinned native contracts and optional real-runtime/installed smoke for the advertised support scope.

## Exit and next work

Mark Claude baseline accepted only with evidence; proceed to scheduled handoff/native extensions. Codex remains an earlier baseline. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
