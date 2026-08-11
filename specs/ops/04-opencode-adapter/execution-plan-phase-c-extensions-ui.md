# 04 — Phase C: optional extensions, stores and settings UI

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisite:** Phase B Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Preserve rich existing capabilities without reshaping the common adapter core.

## Agent handoff boundary

Own optional feature extensions, runtime-specific stores/panels, capability
descriptors, and a parity/deferred ledger. Do not migrate legacy persisted sessions.

## Tasks

### AS04-C-01 — Establish parity/deferred ledger

Enumerate lifecycle actions, commands, search, configuration, provider auth,
MCP, skills, agents, todos, diffs, file status, and language-service behavior.

**Acceptance:** Every existing user-visible feature has an owner, target extension, test, or explicit deferment rationale.

### AS04-C-02 — Port lifecycle and workspace extensions

Implement supported fork/revert/share/summarize, commands, file search, todos,
diffs, file status, and language-service extensions.

**Acceptance:** Each action is capability-gated and unavailable actions cannot produce no-op requests.

### AS04-C-03 — Port configuration and ecosystem extensions

Implement provider/model management, provider auth, configuration, MCP, skills,
and agent discovery/control as runtime-specific extensions.

**Acceptance:** Credentials remain host-side; common UI imports no provider types.

### AS04-C-04 — Replace stores and preserve settings panels

Move provider-specific frontend stores behind generic/extension state and adapt
rich settings panels to host requests/events.

**Acceptance:** One runtime can refresh/fail independently without clearing another runtime’s session state.

### AS04-C-05 — Extension parity tests

Add fixture/component tests for each retained extension and finalize the deferred ledger.

**Acceptance:** Phase D has a finite, reviewed cutover checklist with no unknown feature category.

## Verification

- Run extension schema/store/component tests and credential redaction checks.
- Walk every parity-ledger row in new-path UI.
- Search common packages for provider-specific extension types.

## Handoff

Phase D starts only after the parity/deferred ledger is reviewed and all retained
features have automated or recorded manual evidence.
