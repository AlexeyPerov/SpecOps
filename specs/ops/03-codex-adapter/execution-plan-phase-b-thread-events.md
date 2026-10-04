# 03 — Phase B: first native coding session and minimum resume

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS03-A accepted.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Deliver a developer vertical slice with real workspace tools, approvals, cancel and continuation of the same native thread after restart.

## Implementation boundary

Own thread/turn transport, item mapping, interactions, basic settings and minimum native-history hydration. Rich configuration/reconciliation belongs to C; installed usability requires D and early 06-B/C.

## Tasks

### AS03-B-01 — Create and persist profile-bound native threads

Implement native thread start/read/resume with workspace rootPath as cwd. Persist runtime/profile/native ID and selected settings through production save; assign SpecOps IDs independently. Handle missing profile/thread without replacement.

**Acceptance:** Two sessions keep distinct threads; fresh app/host state resumes the same profile/thread. Profile deletion or missing history is explicit and cannot mint a hidden replacement session.

### AS03-B-02 — Normalize items, turns and tool execution

Map text/reasoning deltas, tool start/output/result, file-change hints, usage, status, failures and unknown notifications. Keep stable native IDs and host cursor, deterministic delta assembly and single terminal semantics. Support steer only if pinned API allows it; never replay a sent prompt on reconnect.

**Acceptance:** Recorded fixtures assemble deterministically, end once and close the iterator. Profile/session/turn/generation correlation rejects stale events; native execution keeps native tools and policy enforcement.

### AS03-B-03 — Map approvals and supported user input

Map command/file approvals and user-input requests where actually supported to correlated extension requests/replies. Implement allow/deny, answer, cancel/timeout and stale/late reply rejection. An unsupported interaction is capability-gated rather than silently auto-approved.

**Acceptance:** Each pending request resolves once, cannot affect another thread/profile/generation and remains visible on rerender. Restart uses native pending-state semantics or explicit interruption, not invented approval continuity.

### AS03-B-04 — Expose minimum native settings honestly

Populate profile-scoped model catalog. Keep model, reasoning effort, collaboration/plan mode, sandbox and approval policy distinct. Validate supported combinations host-side and record write capability for early 06-B. Do not use catalog listing as proof of account entitlement.

**Acceptance:** Creation UI offers valid settings before first send; selected settings reach native requests. Unsupported controls are hidden/explained and no prompt pretends to enforce read-only.

### AS03-B-05 — Implement interrupt and minimum history hydration

Use native turn interrupt/cancel, distinguish cancelled/failed/interrupted, and settle lost-child/lost-host streams. Hydrate thread history sufficiently to continue a completed session after restart; deduplicate by native IDs. C covers deeper divergent-cache cases.

**Acceptance:** Stop ends a turn within a recorded bound, leaves files unchanged by rollback logic and permits next send when native runtime supports it. Restart preserves visible completed history and same thread without duplicate first prompt.

### AS03-B-06 — Run coding-session fixtures and developer smoke

Run shared contract plus success/tool/edit/allow/deny/question/cancel/failure/unknown/restart fixtures. Manually perform a coding task on B, inspect file effects and continue after a fresh app launch. Test sibling threads and child failure without requiring another vendor adapter.

**Acceptance:** A real task runs through SpecOps UI and native harness, with approval/cancel and minimum resume evidence. This is a developer slice only; it does not mark installed preview readiness.

## Verification

- Run mapper/schema, persistence integration, interaction, strengthened shared contract and UI suites.
- Kill profile child and whole host mid-turn; verify settlement and explicit resume without replay.
- Opt-in workspace task on account B with tool execution and fresh-app restart.

## Exit and next work

C, 06-B and 06-C can consume stable B descriptors/lifecycle without waiting for each other. Usable preview waits for C + 06-B/C + D. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
