# 05 — Phase C: permissions, native settings and ecosystem capabilities

**Date:** 2026-10-04

**Status:** Source implemented and verified; installed/live enforcement gates remain open.

**Evidence:** [Phase C notes and finite native feature ledger](implementation-notes-phase-c.md)

**Prerequisites:** AS05-B accepted.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Expose tested native policy/configuration depth through optional extensions.

## Implementation boundary

Own native callbacks, validated settings and feature ledger; never emulate unsupported capabilities with prompts.

## Tasks

### AS05-C-01 [DONE source] — Map native permission and user-input callbacks

Correlate callbacks with profile/session/turn/request/generation; implement supported allow/deny/answer/cancel/timeout. After restart follow actual native pending-state semantics or mark interruption, without pretending an old callback survived.

**Acceptance:** Every request resolves once; stale replies cannot approve another turn/profile and unsupported interactions are not auto-approved.

### AS05-C-02 [DONE source] — Validate native tool and autonomy settings

Keep model, native autonomy/approval controls, allowed/disallowed tools, turn limit/budget and write capability distinct. Enforce supported settings at host boundary.

**Acceptance:** Invalid/unsupported controls fail before a turn; descriptors feed neutral creation and early writer visibility.

### AS05-C-03 [DONE selected scope] — Record native config and ecosystem feature ledger

Check workspace instructions, profile/native settings, MCP, skills, hooks/subagents and supported lifecycle actions. Ledger separates execution, display and editing; implement selected SDK extensions only.

**Acceptance:** Each advertised feature has pinned native evidence; config scope is visible and common UI works without every optional extension.

### AS05-C-04 [DONE source] — Capability UI and fixture coverage

Wire descriptors to creation/settings/action UI and add fixtures for each
supported/unsupported combination.

**Acceptance:** Disabled/hidden states explain runtime limitations and never offer a no-op action.

## Verification

- Run adapter/profile/schema/mapper and capability fixtures appropriate to this phase, using no live credential by default.
- Check error/log/transcript/export boundaries with canaries and late profile/generation events.
- Record pinned native contracts and optional real-runtime/installed smoke for the advertised support scope.

## Exit and next work

D follows matched native capability manifest and UI/interaction evidence. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.

Source acceptance: correlated SDK callbacks, validated immutable native controls, neutral UI and finite ecosystem ledger are implemented and verified in the linked notes. Native managed policy/memory scope and real paid/installed enforcement remain external gates for D. Isolated filesystem settings are the only selected config scope; richer ecosystem editors/actions remain explainably unavailable.
