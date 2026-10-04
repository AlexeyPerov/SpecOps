# 01 — Phase F: Sessions UX integration and foundation exit

> Completed implementation record. Original task IDs are preserved as historical evidence. Open acceptance and current delivery are in [active stabilization](../../01-foundation-stabilization/execution-plan.md) and the [roadmap](../../roadmap.md); archiving is not new acceptance.

**Date:** 2026-08-11
**Status:** Historical implementation complete; open acceptance tracked in 01-S / 02-A / 03-B.
**Prerequisites:** Phases A–E Done
**Scope:** [`README.md`](README.md)
**Index:** [`execution-plan.md`](execution-plan.md)
**Goal:** Deliver the runtime-neutral Sessions vertical slice through the fake host.

## Progress

- **Phase E Done** — Tauri supervision + IPC bridge + process-tree cleanup
  (`app/src-tauri/src/agent_host.rs`, commands `agent_host_*`, event
  `specops/agent-host/event`, 13 supervision tests).
- **Phase F host-client foundation landed** — `app/src/lib/session/host/`:
  typed `AgentHostClient` over the Tauri commands + event stream (discover /
  auth / catalogs / sessions / turns / replies / health), and a turn reducer
  that folds runtime-neutral `SessionEvent`s into the existing
  `ChatMessage` part/tool model. 10 unit tests.
- **Phase F legacy purge landed (2026-08-15):**
  - **F-01** — `SessionIndexEntry` / `ChatThreadMetadata` / `chatStore` link
    API / persistence codec are runtime-neutral (`runtimeId` /
    `nativeSessionId` / `modelId` / `shareUrl` / `parentSessionId` /
    `selectedModeId`); the store enforces immutable runtime bindings.
    Breaking sessions-state reset (no migration, per repo policy).
  - **F-03** — the send pipeline drives the supervised Agent Host client
    (`services/agentHostRuntime.ts`: lazy start, create/resume binding,
    `turn.send` folding, permission/question replies, cancel, host-restart
    recovery); agent handlers keep only host-supported lifecycle actions;
    Sessions UI (sidebar / panel / composer) renders runtime, model, mode,
    host health, and turn status with explanatory states for unavailable
    catalogs; sidecar-fed UI glue (todo/diff panels, slash/mention pickers,
    agent/provider catalog picker, message hydration, session-list import
    entry) is removed or hidden.
  - **F-02** — model/mode selection before the first send through host
    catalogs; the runtime binding is fixed per session (no runtime switching
    UI; "new session" is the path to another runtime).
  - **F-04** — store binding-immutability tests, host-pipeline unit tests
    with mocked client bindings, neutral persistence round-trip, phase-F
    neutrality absence guard (no provider-prefixed session field, no vendor
    SDK import in common code); architecture docs rewritten for Sessions-only;
    OpenCode integration docs archived; changelog records the breaking reset.

## Follow-up cleanup (documented, not blocking)

- The Sessions dev gate still lives under `settings.opencode` /
  **Settings → Workspaces → OpenCode** (OpenCode settings panels and sidecar
  health UI remain as the phase-04 adapter-candidate surface). Renaming the
  gate to a neutral `settings.sessions` surface is deferred cleanup.
- `ai/backends/workspaceAgentBackend`, the opencode backend helpers, and
  `src-tauri/src/opencode_sidecar.rs` remain untouched as the phase-04
  adapter candidate.

## Tasks

### AS01-F-01 — Normalize Sessions naming and state [DONE]

Replace provider-specific labels, gates, ids, and stores in the workspace
session browser/header/composer with common runtime/session terminology.

**Acceptance:** Common UI code contains no provider-prefixed session field and
renders runtime, model, mode, health, status, and capabilities.

### AS01-F-02 — Implement session creation and immutable binding [DONE]

Add runtime → model → mode → optional-settings creation flow. After creation,
replace runtime switching with “New session with…”.

**Acceptance:** Runtime binding cannot mutate; unavailable capabilities and
catalogs have explanatory states.

### AS01-F-03 — Connect lifecycle and capability actions [DONE]

Wire fake create/resume/send/stream/cancel, permissions/questions, restart
recovery, persistence, and capability-gated actions through Tauri and host.

**Acceptance:** The complete fake lifecycle works without direct host access or
provider types in frontend state.

### AS01-F-04 — Foundation regression and docs gate [DONE]

Add UI/state/end-to-end tests, Chat/Cloud absence guards, non-AI regressions,
architecture docs, breaking changelog entry, and milestone status updates.

**Acceptance:** All README/index exit checks pass and phase 02 can integrate a
real adapter without changing the product model.

## Verification

- Run fake-host E2E, component/state, persistence, protocol and supervision suites.
- Run editor, workspace, version-control and non-AI regression suites.
- Manually exercise create, restart/resume, cancel, question/permission and crash recovery.

## Current follow-up

Use [01 stabilization](../../01-foundation-stabilization/execution-plan.md), then [02 Codex](../../02-codex-adapter/execution-plan.md). Historical IDs and original task descriptions are not active dependency instructions.
