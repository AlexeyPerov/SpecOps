# 04 — Phase B: core sessions, events and interaction parity

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS04-A accepted.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Make OpenCode a second native runtime through common profile-bound Sessions.

## Implementation boundary

Own required core create/resume/send/cancel/history/tools/interactions/catalog and normalized fixtures. Optional rich UI features remain ledger entries for 06-B.

## Tasks

### AS04-B-01 — Port core native lifecycle and persisted binding

Map session creation/read/resume and native message history to immutable runtime/profile/native binding and production persistence. Archive/list controls are capability-gated as needed. Use real workspace rootPath as cwd and no legacy-state migration.

**Acceptance:** Independent Codex/OpenCode sessions restart/resume their own native histories; missing native history/profile preserves metadata and offers an explicit state.

### AS04-B-02 — Normalize native event stream

Map text/reasoning/tools/steps/subtasks/file changes/usage/errors/compaction/reconnect and bounded unknown events. Use stable native IDs with host-assigned cursor and profile/generation correlation. Compare legacy normalized fixtures and document corrections.

**Acceptance:** Ordering/deduplication/terminal completion pass contract; late events cannot mutate Codex or another profile. Each core parity difference is resolved or justified with evidence.

### AS04-B-03 — Port permissions, questions and cancel

Use shared capability extensions for correlated native allow/deny/answer/cancel/timeout and stale reply handling. Settle interrupted host/runtime streams without re-sending prompt.

**Acceptance:** Native policy remains authoritative, interaction resolves once and Stop never rolls back files or leaves a hung iterator.

### AS04-B-04 — Accept core parity independent of rich extensions

Run core history/catalog/settings/stream/tools/interaction/failure/restart fixtures plus shared contract and real-native opt-in smoke. Finalize required vs later ledger classifications without treating unimplemented rich features as preserved.

**Acceptance:** Core is accepted for 04-C; no unknown required category remains. Optional 06-B features are explicitly unavailable until implemented, and Codex regression checks pass.

## Verification

- Run shared adapter suite, mapper/profile/persistence and legacy/new core comparisons.
- Opt-in create/tool/approval/question/cancel/restart smoke; keep Codex usable during OpenCode child failure.

## Exit and next work

04-C performs core cutover next. 06-B is not a prerequisite and moves to later native-extension slot. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
