# 01 — Phase F: Sessions UX integration and foundation exit

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisites:** Phases A–E Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Deliver the runtime-neutral Sessions vertical slice through the fake host.

## Agent handoff boundary

Own common Sessions UI/state integration, capability-aware actions, end-to-end
fake-runtime coverage, and milestone exit. Do not add a real adapter.

## Tasks

### AS01-F-01 — Normalize Sessions naming and state

Replace provider-specific labels, gates, ids, and stores in the workspace
session browser/header/composer with common runtime/session terminology.

**Acceptance:** Common UI code contains no provider-prefixed session field and
renders runtime, model, mode, health, status, and capabilities.

### AS01-F-02 — Implement session creation and immutable binding

Add runtime → model → mode → optional-settings creation flow. After creation,
replace runtime switching with “New session with…”.

**Acceptance:** Runtime binding cannot mutate; unavailable capabilities and
catalogs have explanatory states.

### AS01-F-03 — Connect lifecycle and capability actions

Wire fake create/resume/send/stream/cancel, permissions/questions, restart
recovery, persistence, and capability-gated actions through Tauri and host.

**Acceptance:** The complete fake lifecycle works without direct host access or
provider types in frontend state.

### AS01-F-04 — Foundation regression and docs gate

Add UI/state/end-to-end tests, Chat/Cloud absence guards, non-AI regressions,
architecture docs, breaking changelog entry, and milestone status updates.

**Acceptance:** All README/index exit checks pass and phase 02 can integrate a
real adapter without changing the product model.

## Verification

- Run fake-host E2E, component/state, persistence, protocol and supervision suites.
- Run editor, workspace, version-control and non-AI regression suites.
- Manually exercise create, restart/resume, cancel, question/permission and crash recovery.

## Handoff

Mark milestone 01 Done, update [`../roadmap.md`](../roadmap.md), then hand the
stable host/adapter contract to phase 02.
