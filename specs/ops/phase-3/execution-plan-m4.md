# Phase 3 Milestone 4 Execution Plan — OpenCode sidecar lifecycle and workspace agent UX

**Spec:** [phase-3.md](./phase-3.md)  
**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [execution-plan-m3.md](./execution-plan-m3.md) and [execution-plan-m3-5.md](./execution-plan-m3-5.md) complete

Post-MVP follow-up covering:

1. **Sidecar lifecycle** — switching workspace folders in **Sidecar** mode stops and restarts the OpenCode sidecar unnecessarily; `opencode serve` is directory-agnostic at launch and SpecOps already passes `directory` per HTTP request.
2. **Connection reliability** — URL-mode health checks, auth, and port conflicts with external OpenCode servers.
3. **Workspace agent composer** — workspace agents (`ws-*`) must not reuse Chat (`chat-http`) settings, modes, providers, or models in the UI or thread metadata; lanes share only internal primitives (backend client, shared widgets, send/stream plumbing).

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task.

## Problem

Today:

1. `start_or_attach` in `opencode_sidecar.rs` calls `stop_child` when `should_reuse_sidecar` returns false.
2. `should_reuse_sidecar` requires the requested `directory` to match `inner.directory` in addition to process health.
3. `spawn_sidecar` runs `opencode serve --hostname … --port …` with **no** workspace `directory` argument and no `current_dir` binding.
4. `createHttpOpencodeClient` in `workspaceAgentBackend.ts` already sends `directory: workspaceRootPath` on every API call.
5. `syncOpencodeSidecarEffect` re-attaches on every active workspace change, triggering the restart policy above.

Result: **each workspace switch in sidecar mode tears down and respawns OpenCode**, adding latency and port/process churn even though the server is directory-agnostic at launch.

## Goal

Keep a single OpenCode sidecar process running from first attach until app exit (or explicit disable/toggle-off), regardless of which workspace folder is active. Workspace context continues to be selected per request via the existing `directory` query parameter.

Give workspace agents a **dedicated OpenCode composer** (agents/modes like plan/build, OpenCode providers, OpenCode models) with **no shared selection state** with Chat HTTP (connections, SpecOps ask/review modes, HTTP model catalogs).

**Out of scope:** multi-sidecar pools, per-workspace ports, mDNS/port auto-discovery, provider/auth configuration docs, merging Chat and workspace into one settings surface.

## Assumptions

- Phase-3 MVP and M3.5 opt-in gating are complete.
- OpenCode server health semantics remain `GET /global/health` on the sidecar base URL.
- `opencode.enabled: false` and sidecar toggle-off still call `stopOpencodeSidecar` (unchanged).
- App exit still stops the sidecar via `OpencodeSidecarState::stop_sync` in `lib.rs`.

## Confidence and Risks

Confidence: High.

Resolved constraints:

1. Sidecar spawn does not bind a workspace directory; reuse logic is the only restart trigger on switch.
2. HTTP client already scopes requests by `directory` query param.
3. Existing tests document current directory-mismatch restart behavior and can be updated in place.

Residual uncertainties:

1. Confirm no OpenCode version in use relies on sidecar process cwd for config discovery (spawn does not set `current_dir` today).
2. Status UI may still expose `directory` on sidecar status — decide whether to track “last active workspace” for diagnostics only.

## Decisions applied

| ID | Decision | Implication |
|----|----------|-------------|
| L1 | Reuse sidecar when process is alive and healthy | Remove directory equality from `should_reuse_sidecar` |
| L2 | Stop sidecar only on app exit, explicit stop/restart commands, toggle-off, or unhealthy process | Workspace switch does not call `stop_child` |
| L3 | Per-request `directory` remains authoritative | No change to `workspaceAgentBackend.ts` client contract |
| L4 | URL mode health/connect reliability (Task 3) | Probe via timeout + auth; reuse existing server on port conflict |
| L5 | Chat and workspace lanes are separate at settings/selection layer (Tasks 4–5) | No HTTP connection/mode/catalog pickers in `ws-*`; shared code limited to primitives |

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 1: Keep sidecar running across workspace switches [Score:6] [Agent:medium] [DONE]

**Required context**

1. [phase-3.md](./phase-3.md) — Server deployment (E1C), sidecar lifecycle deliverable
2. `app/src-tauri/src/opencode_sidecar.rs` — `should_reuse_sidecar`, `start_or_attach`, `spawn_sidecar`
3. `app/src/lib/services/appShellEffects.ts` — `syncOpencodeSidecarEffect`
4. `app/src/lib/ai/backends/workspaceAgentBackend.ts` — `createHttpOpencodeClient` (`directory` query param)
5. `app/src/lib/services/appShellEffects.opencodeSidecar.test.ts` — sidecar effect tests
6. `app/src-tauri/src/opencode_sidecar.rs` — `#[cfg(test)]` module (`should_not_reuse_when_directory_differs`)

- Change `should_reuse_sidecar` to return true when `child_alive && health_ok`, **without** comparing `current_directory` to `requested_directory`.
- In `start_or_attach`, when reusing an existing healthy sidecar, update `inner.directory` to the requested workspace (diagnostics / status only) instead of restarting.
- Ensure `opencode_sidecar_attach_workspace` remains idempotent for repeated calls with the same or different directories while the process is healthy.
- Verify `syncOpencodeSidecarEffect` behavior: switching `activeWorkspaceRoot` should not surface error health solely due to directory change.
- Update Rust unit tests: replace `should_not_reuse_when_directory_differs` with a test that directory mismatch **does** reuse when healthy; add test that unhealthy/dead process still triggers restart.
- Update TS tests in `appShellEffects.opencodeSidecar.test.ts` if they encode restart-on-switch assumptions.
- Manual smoke (sidecar mode, `opencode.enabled: true`):
  - Open workspace A, confirm sidecar healthy.
  - Switch to workspace B, confirm sidecar stays running (same PID/port) and agents/catalog work for B.
  - Switch back to A; confirm no second spawn.

**Acceptance checklist**

- Workspace switch does not stop/restart a healthy OpenCode sidecar process.
- Agent send, catalog refresh, and session flows work for each switched workspace root.
- Unhealthy or exited sidecar still triggers restart on next attach.
- Toggle-off (`opencode.enabled: false`) and app exit still stop the sidecar.
- `cargo test` (sidecar module) and `npm test` pass from `app/`.

Dependencies: none.

---

#### Task 2: Defer OpenCode sidecar to workspace lifecycle (not app launch) [Score:5] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/services/workspaceLifecycle.ts` — lifecycle gate (`markWorkspaceLifecycleActive`, `isWorkspaceLifecycleActive`)
2. `app/src/lib/services/appShellRuntime.ts` — startup restore calls `restoreWorkspaceAgentSession` with `skipOpencodeReconcile`
3. `app/src/lib/services/appShellEffects.ts` — `syncOpencodeSidecarEffect` gated on `workspaceLifecycleActive`
4. `app/src/lib/commands/handlers/workspace.ts` — `workspace.add` marks lifecycle
5. `app/src/lib/services/workspaceContextMenuController.ts` — activity-rail workspace switch marks lifecycle

- On app launch / session restore, do **not** attach or reconcile OpenCode sidecar (no `attachOpencodeSidecarWorkspace`, no `reconcileWorkspaceSessionMappings` via `listSessions`).
- Start sidecar only after explicit workspace lifecycle events: user adds workspace, switches to a workspace context in the activity rail, or workspace scope changes via `syncAgentTabEffect` after lifecycle is marked.
- Health refresh via settings (`requestOpencodeHealthRefresh`) remains user-initiated and may read status without spawning on launch.
- Tests cover lifecycle gate and startup skip paths.

**Acceptance checklist**

- Cold launch with restored workspace does not spawn OpenCode sidecar until user interacts with workspace lifecycle.
- Adding or switching workspace folders attaches sidecar as before.
- App launch startup no longer blocks on sidecar health wait.

Dependencies: none (may be combined with Task 1 in one PR).

---

#### Task 3: OpenCode URL health checks, auth, and port-conflict reuse [Score:7] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/services/appShellEffects.ts` — `syncOpencodeSidecarEffect`, `requestOpencodeHealthRefresh` (URL-mode `fetch` to `/global/health`)
2. `app/src/lib/components/settings/OpenCodeSettingsPanel.svelte` — `checkOpencodeConnection` (sets `checking` but does not re-run probe when settings unchanged)
3. `app/src-tauri/src/opencode_sidecar.rs` — `spawn_sidecar` (`PortInUse`), `probe_health`, `HEALTH_TIMEOUT` (10s sidecar probe)
4. `app/src-tauri/tauri.conf.json` — CSP (`default-src` has no `connect-src` for `http://127.0.0.1:*`)
5. `app/src/lib/ai/backends/workspaceAgentBackend.ts` — `createHttpOpencodeClient` (no `Authorization` header today)
6. `app/src/lib/services/providerSecretsStore.ts` — `loadOpencodeServerPassword`
7. `app/src/lib/services/appShellEffects.opencodeSidecar.test.ts` — URL-mode health tests

**Problem (observed)**

- **Sidecar mode:** `Port 4096 is already in use` when another OpenCode server is running (e.g. VS Code **Kilo** extension’s `kilo` process on default port 4096).
- **URL mode:** **Check connection** can stay on **Checking** indefinitely: the button does not call `requestOpencodeHealthRefresh` when `mode`/`baseUrl` are unchanged; URL probes use bare `fetch` with no timeout.
- **Auth:** External servers (Kilo, manual `opencode serve` with `OPENCODE_SERVER_PASSWORD`) return **401** on `/global/health`; SpecOps stores **Server password** but does not send HTTP basic auth on health checks or API calls.
- **CSP:** Tauri webview CSP may block frontend `fetch` to `http://127.0.0.1:4096` (no `connect-src` for localhost).

**Changes**

- **Check connection** must always trigger a fresh probe (call `requestOpencodeHealthRefresh` directly, or equivalent), not only when `opencodeMode`/`opencodeBaseUrl` change.
- Add a **10s timeout** on URL-mode health `fetch` (align with sidecar `HEALTH_TIMEOUT`); map timeout to `error` with a clear message.
- Send **HTTP basic auth** on URL health probes and `createHttpOpencodeClient` requests when a server password is configured (username `opencode`, per OpenCode server docs).
- Treat **401** as **degraded** with recovery hint to set **Server password**; **200** → healthy.
- Fix **CSP** or move URL health probe to **Rust** (reuse `probe_health` / `ureq` pattern from sidecar) so localhost checks work reliably in the Tauri webview.
- **Sidecar port conflict:** when port 4096 is in use, probe `http://127.0.0.1:4096/global/health` (with auth if configured); if healthy, surface **degraded** or auto-hint **URL mode** instead of hard `PortInUse` failure (optional: auto-switch transport to URL with detected base URL — document choice in implementation).
- Tests: Check-connection re-probe; fetch timeout; 401 with/without password; port-in-use probe path; CSP/Rust probe regression.
- Manual smoke:
  - Kilo (or `opencode serve`) already on 4096 → URL mode + password → **Check connection** resolves to healthy within 10s.
  - **Check connection** twice with unchanged URL still completes (not stuck on Checking).
  - Sidecar mode with existing healthy server on 4096 → actionable message or URL attach, not opaque port error.

**Acceptance checklist**

- **Check connection** never leaves health stuck on **Checking** when settings are unchanged.
- URL health probe completes or fails within **10s**.
- Server password is used for URL-mode health and workspace API calls when set.
- Localhost OpenCode health checks work in the Tauri app (CSP or Rust probe).
- Port 4096 already occupied by a healthy OpenCode server yields a recoverable path (URL attach or clear guidance), not only `PortInUse`.
- `npm test` and `cargo test` (sidecar module) pass from `app/`.

Dependencies: none (orthogonal to Tasks 1–2; may ship in same milestone).

---

#### Task 4: Dedicated workspace agent composer (OpenCode-only pickers) [Score:8] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/components/ChatComposer.svelte` — reuses `ChatModePicker` + `ChatConnectionPicker` for both `chat-http` and `workspace`
2. `app/src/lib/components/ChatConnectionPicker.svelte` — HTTP connection + HTTP model selects
3. `app/src/lib/components/ChatPanel.svelte` — passes `opencodeCatalog`, `supportedModes`, HTTP provider props into composer
4. `app/src/lib/ai/opencodeCatalog.ts` — loads `models`, `providers`, `agents` from OpenCode (agents/providers not surfaced in UI today)
5. `app/src/lib/ai/providers/selection.ts` — `listSelectableChatConnections` / `listSelectableModelsForConnection` (HTTP-only)
6. `README.md` — workspace agents use OpenCode, not **Settings → Chats → Providers**

**Problem (observed)**

- Workspace agent composer shows **HTTP connection labels** (e.g. GLM Coding) and **HTTP model catalogs** (e.g. GLM 4.5-air) when OpenCode catalog is unloaded or empty.
- User expects OpenCode **agents** (plan / build), **providers** from OpenCode config, and **models** from the running OpenCode server — not Chat HTTP settings.
- `opencodeCatalog.agents` and `opencodeCatalog.providers` are fetched but unused in the composer.

**Lane separation rule**

- **Chat (`chat-http`)** and **workspace (`ws-*`)** must **not** share settings, modes, providers, or models in the composer or thread selection UX.
- Shared code is limited to internal primitives: `Select.svelte`, `workspaceAgentBackend`, stream/tool reducers, generic layout — not picker data sources or catalogs.

**Changes**

- Add a workspace-only composer path (new component or `ChatComposer` branch on `chatContextKind === "workspace"`) that **does not render** `ChatConnectionPicker` or SpecOps `ChatModePicker` backed by HTTP/`chatModesSettings`.
- Surface OpenCode catalog in workspace composer:
  - **Agent / mode** picker from `opencodeCatalog.agents` (e.g. plan, build — labels from OpenCode).
  - **Provider** picker from `opencodeCatalog.providers` (OpenCode provider ids/names).
  - **Model** picker from `opencodeCatalog.models` (always when catalog is loaded; clear empty/error state when not).
- Empty/loading/error states must reference **Settings → Workspaces → OpenCode** and **Refresh model list**, never **Settings → Chats → Providers**.
- Fix dropdown interaction regressions in workspace composer if caused by overlay/z-index (verify `Select` works with settings dialog closed).
- Tests: workspace composer does not call `listSelectableChatConnections`; renders OpenCode catalog options when loaded; chat-http composer unchanged.

**Acceptance checklist**

- Workspace agent composer never shows HTTP connection names or HTTP model catalogs.
- Workspace composer shows OpenCode agents, providers, and models when catalog is loaded.
- Chat (`chat-http`) composer behavior unchanged (HTTP connections, SpecOps modes, HTTP catalogs).
- README empty-hint / blocked copy aligned with workspace vs chat settings locations.
- `npm test` passes from `app/`.

Dependencies: Task 3 recommended (catalog API calls need auth/CSP); UI can land in parallel with stubbed catalog.

---

#### Task 5: Isolate workspace agent metadata and preflight from Chat HTTP [Score:7] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/state/chatStore/threadProviderSelection.ts` — `getActiveChatProvider`, `switchThreadProvider`, thread `metadata.provider` / `connectionId` / `selectedModelId`
2. `app/src/lib/state/chatStore/access.ts` — `checkActiveWorkspaceCapabilities` uses HTTP provider from thread metadata
3. `app/src/lib/components/ChatPanel.svelte` — `supportedModes` from HTTP capability preflight on workspace threads
4. `app/src/lib/ai/chatSendPipeline.ts` — `validateOpencodeBackendSend`, `executeWorkspaceAgentBackendTurn` (OpenCode send ignores SpecOps ask/review today)
5. `app/src/lib/ai/composerSelectionActions.ts` — `selectConnection` / `selectMode` wired to HTTP provider switching
6. `app/src/lib/domain/chat.ts` — thread metadata fields (`opencodeModelId`, `opencodeProviderId`, `opencodeSessionId`)

**Problem**

- Workspace agent tabs still persist and read **HTTP-oriented** thread metadata (`provider: "http"`, `connectionId`, SpecOps `mode: "ask"`) and run HTTP capability preflight for mode lists.
- Workspace sends use OpenCode backend only, but composer selection mutates chat HTTP state — the lanes are coupled in storage and preflight even when send path is decoupled.

**Lane separation rule**

- Workspace agent tabs store **OpenCode-only** selection fields (agent id, provider id, model id from OpenCode catalog) — not HTTP `connectionId`, not `ChatProviderId`, not SpecOps builtin modes unless explicitly mapped to OpenCode.
- Chat HTTP tabs keep existing HTTP/debug metadata; no reads of OpenCode catalog for chat-http sends.

**Changes**

- Extend workspace thread/agent metadata (or parallel workspace-only fields) for selected OpenCode **agent**, **provider**, and **model**; stop using HTTP `connectionId` / `provider: "http"` as defaults for new workspace agents.
- Workspace preflight (`runAccessPreflight` / capability check for `ws-*`) validates OpenCode health + catalog readiness + filesystem access — **not** HTTP provider config or `listSelectableChatConnections`.
- Wire workspace send (`sendPrompt` / session create) to pass selected OpenCode **agent** and **provider** when the OpenCode API supports them (document API fields in implementation).
- `composerSelectionActions` for workspace: update OpenCode metadata only; do not call `switchThreadProvider` / HTTP connection switch paths.
- Migration: no persisted-data compatibility shims (active dev); normalize new workspace agents to OpenCode metadata on create; stale HTTP metadata on existing tabs can be ignored or cleared on first open.
- Tests: workspace preflight does not require HTTP connections configured; chat-http preflight still requires HTTP; metadata isolation per scope.

**Acceptance checklist**

- New workspace agents do not default to HTTP provider/connection metadata.
- Workspace capability/preflight does not depend on **Settings → Chats → Providers**.
- Chat HTTP threads unaffected; still use HTTP provider, connection, and SpecOps modes.
- Workspace send uses OpenCode-selected agent/provider/model (per API contract).
- `npm test` passes from `app/`.

Dependencies: Task 4 (composer must write OpenCode-only selection); Task 3 recommended for reliable catalog/preflight.

---

## Dependency graph

```text
Task 1
Task 2
Task 3
Task 4 ──► Task 5
```

## Mapping to phase-3 task IDs

| Phase-3 ID | Execution plan task |
|------------|---------------------|
| P3-10 (new) | Task 1 — sidecar reuse across workspace switches |
| P3-11 (new) | Task 2 — defer sidecar attach to workspace lifecycle (not app launch) |
| P3-12 (new) | Task 3 — OpenCode URL health checks, auth, and port-conflict reuse |
| P3-13 (new) | Task 4 — dedicated workspace agent composer (OpenCode-only pickers) |
| P3-14 (new) | Task 5 — isolate workspace agent metadata and preflight from Chat HTTP |

## Post-MVP follow-up

- README clarification: sidecar is automatic; `cd … && opencode serve` is URL-mode only; provider auth is global (`auth.json`), project `opencode.json` uses workspace root.
