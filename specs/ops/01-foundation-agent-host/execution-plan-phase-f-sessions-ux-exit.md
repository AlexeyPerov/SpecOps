# 01 — Phase F: Sessions UX integration and foundation exit

**Date:** 2026-08-11  
**Status:** In progress — host-client foundation landed; legacy-type purge remains  
**Prerequisites:** Phases A–E Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Deliver the runtime-neutral Sessions vertical slice through the fake host.

## Progress (2026-08-12)

- **Phase E Done** — Tauri supervision + IPC bridge + process-tree cleanup
  (`app/src-tauri/src/agent_host.rs`, commands `agent_host_*`, event
  `specops/agent-host/event`, 13 supervision tests).
- **Phase F host-client foundation landed** — `app/src/lib/session/host/`:
  typed `AgentHostClient` over the Tauri commands + event stream (discover /
  auth / catalogs / sessions / turns / replies / health), and a turn reducer
  that folds runtime-neutral `SessionEvent`s into the existing
  `ChatMessage` part/tool model. 10 unit tests.

## Remaining (full legacy purge — the bulk of F)

The existing workspace Sessions UI is deeply OpenCode-coupled. The host client
is ready to drive it, but the common code still carries provider-prefixed state
and constructs the OpenCode backend directly. Finishing F requires:

- **F-01 — Normalize domain/store/codec:** drop the `opencode*` fields from
  `SessionIndexEntry` / `ChatThreadMetadata` (`app/src/lib/domain/chat.ts`) onto
  the neutral phase-B binding (`runtimeId` / `nativeSessionId` / `modelId` /
  `shareUrl` / `parentSessionId`); rewire the `chatStore` link API
  (`sessions.ts` `SessionLinkPatch` → neutral binding), the `threadHelpers` /
  `threadMetadata` metadata picks, and the persistence codec
  (`chatPersistenceCodec.ts`). Cascade: `+page.svelte`, `closeTabInPane.ts`,
  `documentTabsSlice.ts`, `sessionSnapshotSanitizer.ts`, `SessionsSidebar`,
  `ChatPanel`, `ChatComposer`, `workspaceAgentSession.ts`,
  `workspaceAgentHydration.ts`.
- **F-03 — Rewire the send pipeline** (`chatSendPipeline.ts`) to drive turns
  through `createAgentHostClient().sendTurn` + `foldSessionEvent`, replacing the
  `createWorkspaceAgentBackend("opencode", …)` + `streamEvents` construction.
  Re-route the agent lifecycle handlers (`appShellAgentHandlers.ts`) —
  reconcile/rename/fork/revert/share/summarize/export — to capability-gated
  host actions (the fake runtime advertises `fork` only; revert/share/summarize
  hide when unsupported).
- **F-02 — Session creation flow:** runtime → model → mode via host discovery +
  catalogs; immutable binding after creation; "New session with…" replaces
  runtime switching; explanatory states for unavailable catalogs/capabilities.
- **F-04 — Regression + docs gate:** Chat/Cloud absence guard (no `opencode*`
  session field, no `@opencode-ai/sdk` import in common UI), neutral
  persistence round-trip, E2E fake lifecycle through the host, non-AI suites
  green, architecture docs, breaking changelog, milestone 01 → Done.

The `WorkspaceAgentBackend` / OpenCode sidecar code is intentionally left
intact as the phase-04 adapter candidate; the purge removes its use from
**common** UI/state/pipeline only.

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
