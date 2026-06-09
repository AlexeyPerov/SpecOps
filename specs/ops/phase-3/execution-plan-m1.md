# Phase 3 Milestone 1 Execution Plan — Sidecar lifecycle, client, sessions

**Spec:** [phase-3.md](./phase-3.md)  
**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [phase-1.md](../phase-1/phase-1.md) foundations complete

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task. Milestone 2 depends on this milestone completing.

## Assumptions

- `WorkspaceAgentBackend` remains a phase-1 stub and is the intended abstraction point for OpenCode integration.
- OpenCode deployment policy is fixed (E1C): default Tauri sidecar + optional external server URL/password path.
- No legacy workspace HTTP thread migration into OpenCode sessions (E2A).
- Storage and session schemas may change without compatibility shims.
- Workspace context UX (tabs/sidebar/project panel) remains workspace-first; this milestone builds platform/runtime infrastructure first.
- Workspace HTTP send path remains available until milestone 3 cutover is complete.

## Confidence and Risks

Confidence: Medium.

Resolved constraints:

1. Product/runtime split is defined in [phase-3.md](./phase-3.md) and [roadmap.md](../roadmap.md) (E1C, E3B).
2. Backend seam exists in `workspaceAgentBackend.ts`, so OpenCode wiring can land behind a stable interface.
3. Directory binding requirement is explicit: workspace `rootPath` maps to OpenCode `directory`.

Residual uncertainties:

1. Exact sidecar process ownership model (per-workspace vs shared process with per-request directory) must be pinned in Task 1.
2. OpenCode SDK stream and event shapes may need an internal adapter layer to avoid leaking SDK specifics into UI.
3. Session ownership model (`agentId` to OpenCode session id) needs deterministic recovery behavior after app restart.

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 1: OpenCode sidecar lifecycle in Tauri (P3-1) [Score:9] [Agent:heavy] [DONE]

**Required context**

1. [phase-3.md](./phase-3.md) — Server deployment (E1C), Deliverables
2. [roadmap.md](../roadmap.md) — Product lanes and workspace backend model
3. `app/src-tauri/` process/spawn command patterns used by existing services
4. Existing app settings/state modules that host service URL configuration

- Add OpenCode sidecar manager in Tauri layer:
  - start/stop/restart hooks
  - process health checks
  - deterministic teardown on app close
- Reserve sidecar startup contract for workspace runtime:
  - returns base URL + health status
  - includes failure details for UI diagnostics
- Handle lifecycle edge cases:
  - port in use / stale process
  - missing binary / launch failure
  - health timeout and retry window
- Add workspace-directory-aware attach behavior (if sidecar already running, reuse where valid; otherwise restart).
- Provide tauri command(s) callable from frontend runtime service.

**Acceptance checklist**

- Sidecar can be started, health-checked, and stopped from app runtime.
- Port-conflict and launch-failure states produce typed errors (not generic string throws).
- Repeated workspace open/close does not leak orphan OpenCode processes.

Dependencies: none.

---

#### Task 2: OpenCode connection settings + health model (P3-6 partial) [Score:7] [Agent:medium] [DONE]

**Required context**

1. [phase-3.md](./phase-3.md) — Settings deliverables
2. Existing settings schema/store and settings dialog panels
3. Any existing health/status UI pattern used by providers/backends

- Extend settings schema with OpenCode transport mode:
  - `sidecar` (default)
  - `url` (user-provided base URL)
  - optional password/token field in secrets path if required
- Add validation rules for URL mode (trimmed URL, protocol guard, empty handling).
- Add runtime health state model:
  - `unknown`, `checking`, `healthy`, `degraded`, `error`
  - last error message/source
- Wire settings UI controls and health indicator location in workspace settings/status.
- Ensure mode changes trigger runtime reconnect path (no app restart required).

**Acceptance checklist**

- User can switch sidecar vs URL mode in settings.
- Health checks run and display status for active mode.
- Invalid URL/password config yields actionable inline validation or blocked-state copy.

Dependencies: Task 1 (for sidecar mode path); URL mode can be developed in parallel.

---

#### Task 3: Implement `WorkspaceAgentBackend` OpenCode adapter (P3-2) [Score:9] [Agent:heavy]

**Required context**

1. [phase-3.md](./phase-3.md) — OpenCode backend deliverables
2. `app/src/lib/ai/backends/workspaceAgentBackend.ts` — stub interface
3. Existing chat/workspace event stream normalization modules
4. OpenCode SDK integration notes/docs already referenced by project

- Replace phase-1 stub with real OpenCode backend implementation for `id: "opencode"`:
  - client creation per resolved mode (`sidecar`/`url`)
  - request path bound to workspace `rootPath` as `directory`
- Define backend API surface needed by workspace chat runtime:
  - session CRUD
  - prompt/run send
  - stream event iterator
- Normalize OpenCode events into app-level event contract (keep SDK types behind adapter boundary).
- Keep `cursor-local` stub path unchanged for phase 5.
- Add robust error mapping (auth failure, unavailable server, transport errors, invalid directory).

**Acceptance checklist**

- `createWorkspaceAgentBackend("opencode")` returns functional backend implementation.
- Backend can open/create session and stream run events for a workspace directory.
- Frontend consumers do not depend on raw OpenCode SDK event types.

Dependencies: Tasks 1, 2.

---

#### Task 4: Session mapping `agentId` ↔ OpenCode session (P3-3) [Score:8] [Agent:medium]

**Required context**

1. [phase-3.md](./phase-3.md) — Session per agent tab requirement
2. Workspace session persistence/store modules
3. Agent tab lifecycle and restore logic in app state/runtime

- Introduce persisted mapping metadata for workspace agent tabs:
  - `agentId`
  - linked OpenCode `sessionId`
  - last-used model/provider metadata (if needed for restore)
- On tab create/select:
  - create new session or reuse mapped session
  - reconcile missing/deleted remote session with deterministic recovery path
- On app restore:
  - restore tab mappings
  - rehydrate active session if still valid
  - fallback cleanly if missing/unhealthy
- Ensure mapping is workspace-scoped and isolated per `rootPath`.

**Acceptance checklist**

- Agent tab switches target stable OpenCode session identities.
- Restarting app preserves tab-to-session mapping where valid.
- Missing/invalid session mappings recover without crashing or corrupting other tabs.

Dependencies: Task 3.

---

#### Task 5: Milestone 1 tests and verification (P3-8 partial) [Score:7] [Agent:medium]

**Required context**

1. [phase-3.md](./phase-3.md) — Exit criteria subset for backend foundation
2. Tests around `workspaceAgentBackend`, settings store, and session manager
3. Tasks 1–4 outputs

- Add tests for:
  - sidecar lifecycle manager (happy path + failure matrix)
  - settings mode validation and health-state transitions
  - backend adapter event normalization and error mapping
  - session mapping restore/recovery behavior
- Run quality gate from `app/`: `npm test` and `npm run check`.
- Add brief manual smoke script for sidecar mode and URL mode connectivity.

**Acceptance checklist**

- New tests pass and lock in core OpenCode runtime contracts.
- `npm test` / `npm run check` pass from `app/`.
- Milestone 1 artifacts are ready for workspace UI streaming integration (M2).

Dependencies: Tasks 1–4.

---

## Dependency graph

```text
Task 1 → Task 3 → Task 4 → Task 5
Task 2 ↗        ↗
```

Task 2 runs mostly in parallel with Task 1 and is required before Task 3 completion.

## Mapping to phase-3 task IDs

| Phase-3 ID | Execution plan task |
|------------|---------------------|
| P3-1 | Task 1 |
| P3-2 | Task 3 |
| P3-3 | Task 4 |
| P3-6 | Task 2 (partial) |
| P3-8 | Task 5 (partial) |

## Milestone 1 exit criteria

- [x] OpenCode sidecar lifecycle works (start/health/stop/restart).
- [x] Settings support sidecar vs URL mode with health feedback.
- [ ] `WorkspaceAgentBackend("opencode")` supports session CRUD + streaming adapter.
- [ ] Agent-tab to OpenCode-session mapping persists and restores safely.
- [ ] `npm test` / `npm run check` pass.

**Next:** [execution-plan-m2.md](./execution-plan-m2.md)
