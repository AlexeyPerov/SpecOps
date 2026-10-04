# 02 — Phase B: first native coding session and minimum resume

**Date:** 2026-10-04

**Status:** Source implemented and automated checks accepted; authenticated developer smoke pending

**Prerequisites:** AS02-A source/bootstrap evidence accepted; live account gate remains open.

**Evidence:** [B implementation and support boundary](implementation-notes-phase-b.md). Coding requires explicit persisted profile experimental opt-in: the pinned default paginated history cannot support minimum resume. No authenticated coding success or installed readiness is claimed.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Deliver a developer vertical slice with real workspace tools, approvals, cancel and continuation of the same native thread after restart.

## Implementation boundary

Own thread/turn transport, item mapping, interactions, basic settings and minimum native-history hydration. Rich configuration/reconciliation belongs to C; installed usability requires D and early 03-A/03-B.

## Tasks

### AS02-B-01 — Create and persist profile-bound native threads

Implement native thread start/read/resume with workspace rootPath as cwd. Persist runtime/profile/native ID and selected settings through production save; assign SpecOps IDs independently. Handle missing profile/thread without replacement.

**Acceptance:** Two sessions keep distinct threads; fresh app/host state resumes the same profile/thread. Profile deletion or missing history is explicit and cannot mint a hidden replacement session.

### AS02-B-02 — Normalize items, turns and tool execution

Map text/reasoning deltas, tool start/output/result, file-change hints, usage, status, failures and unknown notifications. Keep stable native IDs and host cursor, deterministic delta assembly and single terminal semantics. Support steer only if pinned API allows it; never replay a sent prompt on reconnect.

**Acceptance:** Recorded fixtures assemble deterministically, end once and close the iterator. Profile/session/turn/generation correlation rejects stale events; native execution keeps native tools and policy enforcement.

### AS02-B-03 — Map approvals and supported user input

Map command/file approvals and user-input requests where actually supported to correlated extension requests/replies. Implement allow/deny, answer, cancel/timeout and stale/late reply rejection. An unsupported interaction is capability-gated rather than silently auto-approved.

**Acceptance:** Each pending request resolves once, cannot affect another thread/profile/generation and remains visible on rerender. Restart uses native pending-state semantics or explicit interruption, not invented approval continuity.

### AS02-B-04 — Expose minimum native settings honestly

Populate profile-scoped model catalog. Keep model, reasoning effort, collaboration/plan mode, sandbox and approval policy distinct. Validate supported combinations host-side and record write capability for early 03-A. Do not use catalog listing as proof of account entitlement.

**Acceptance:** Creation UI offers valid settings before first send; selected settings reach native requests. Unsupported controls are hidden/explained and no prompt pretends to enforce read-only.

### AS02-B-05 — Implement interrupt and minimum history hydration

Use native turn interrupt/cancel, distinguish cancelled/failed/interrupted, and settle lost-child/lost-host streams. Hydrate thread history sufficiently to continue a completed session after restart; deduplicate by native IDs. C covers deeper divergent-cache cases.

**Acceptance:** Stop ends a turn within a recorded bound, leaves files unchanged by rollback logic and permits next send when native runtime supports it. Restart preserves visible completed history and same thread without duplicate first prompt.

### AS02-B-06 — Run coding-session fixtures and developer smoke

Run shared contract plus success/tool/edit/allow/deny/question/cancel/failure/unknown/restart fixtures. Manually perform a coding task on B, inspect file effects and continue after a fresh app launch. Test sibling threads and child failure without requiring another vendor adapter.

**Acceptance:** A real task runs through SpecOps UI and native harness, with approval/cancel and minimum resume evidence. This is a developer slice only; it does not mark installed preview readiness.

## Verification

- Run mapper/schema, persistence integration, interaction, strengthened shared contract and UI suites.
- Kill profile child and whole host mid-turn; verify settlement and explicit resume without replay.
- Opt-in workspace task on account B with tool execution and fresh-app restart.

## Exit and next work

C, 03-A and 03-B can consume stable B descriptors/lifecycle without waiting for each other. Usable preview waits for C + 03-A/03-B + D. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.

## Implementation disposition (2026-10-04 17:01 MSK)

| Task | Recorded disposition |
| --- | --- |
| AS02-B-01 | Source and production-path fresh-app/host persistence fixture verified; explicit profile/history failures and same-thread resume. |
| AS02-B-02 | Native process fixtures and unchanged shared contract verified; deterministic tools/text/reasoning/files/usage, native IDs/generations, one terminal and closure. |
| AS02-B-03 | Native correlated command/file approval and opted experimental question fixtures verified; no auto approval, deadlines/late replies and prompt remount/loss settlement. |
| AS02-B-04 | Distinct model/effort/mode/sandbox/policy host validation and creation UI verified; default-off experimental profile setting persisted and coding gated before work. |
| AS02-B-05 | Native interrupt/lost-child fixture and completed legacy-history fresh-host continuation verified. Whole-host/authenticated native timing acceptance remains external. |
| AS02-B-06 | Account-free native/shared/production/UI suites accepted. Real authenticated UI coding task, actual file effects and fresh-app smoke remain pending. |

This plan remains active until its external developer acceptance is recorded. C and early 03-A/B may proceed using the verified source contracts. The detailed pin limitation, official-distribution comparison, reproduction commands and remaining gates are in the linked B evidence.
