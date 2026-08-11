# Phase 3.5 Milestone 13.5 Execution Plan — Lazy OpenCode sidecar & session-tab gating

**Spec:** [phase-3.5.md](./phase-3.5.md)  
**Index:** [execution-plan.md](./execution-plan.md)  
**Prerequisite:** [execution-plan-m13.md](./execution-plan-m13.md) (no hard dependency on M14–M16)

**Status:** [DONE]

**Goal:** stop eager OpenCode sidecar startup on workspace activation and non-session
tabs; start the sidecar only when the user explicitly needs OpenCode (primarily
**Send**), keep the UI responsive during startup, and avoid retry loops after a
hard health/attach failure.

How to use this plan: each task lists **Required context** — read only those paths
for that task. Cross-cutting **Confidence and Risks** applies to every task.

---

## Problem

Today SpecOps starts or re-attaches the OpenCode sidecar from many automatic
paths:

1. **`syncOpencodeSidecarEffect`** — runs when a workspace is lifecycle-active,
   including while the user is on a **file/editor tab** (no `isAgentTabActive`
   gate).
2. **`createClientForWorkspace`** — every OpenCode backend call in sidecar mode
   calls `attachOpencodeSidecarWorkspace` first (catalog refresh, file-status
   badges, config store, session restore, etc.).
3. **Failed health does not block retries** — `opencodeHealth.status === "error"`
   does not prevent the next effect run from calling attach again (e.g. port
   occupied → repeated 10s Rust health waits → tab-switch lag).
4. **Rust attach is synchronous** — `spawn_sidecar` + `wait_for_health` blocks the
   Tauri command for up to ~10s (`thread::sleep` polling loop).
5. **Session restore on workspace switch** — `restoreWorkspaceAgentSession`
   reconciles and hydrates via OpenCode even when the user is not on a session tab.

Symptoms observed in development:

- UI lag when switching tabs/workspaces while sidecar attach fails or retries.
- Logs such as `opencode.config.store` / `skills-failed` with
  `"Failed to start or attach OpenCode sidecar."` from background store refreshes.
- Sidecar spawn attempts while editing files in a workspace (non-session tabs).

Workspace **file editing** does not require OpenCode. Starting the sidecar should
be **lazy** and **session-scoped**.

---

## Scope

### In scope

| Area | Change |
| --- | --- |
| Sidecar lifecycle | Lazy start; remove eager attach from workspace activation |
| Session-tab gating | No automatic OpenCode/sidecar work unless **session (agent) tab** is active |
| Central attach API | Single-flight `ensureOpencodeSidecar({ intent })` with circuit breaker |
| Send path | Primary spawn trigger; in-composer “Starting OpenCode…” state |
| Settings | Explicit spawn/probe only: **Check connection**, **Refresh model list**, OpenCode config panels |
| Background sync | Reconcile + hydrate on session-tab switch under strict conditions (see **L3**) |
| Health effect | `syncOpencodeSidecarEffect` → status/probe only in sidecar mode (no spawn) |
| Rust sidecar | Non-blocking spawn or fast-return + status polling (no 10s IPC block) |
| UX on hard failure | One deduped snackbar → Settings → Workspaces → OpenCode; no auto-retry |
| Readiness checker | Composer allows typing; block/wait only on Send when sidecar not ready |
| Tests | Effects, ensure service, session-tab gates, circuit breaker, send path |
| Docs | `README.md`, `docs/opencode-integration.md` lazy-start behavior |

### Out of scope

| Area | Reason |
| --- | --- |
| M14 `sidecarPort` setting | Separate milestone; this plan stays compatible (pass port into ensure API when M14 lands) |
| URL mode spawn | Unchanged — probe external server only, never spawn |
| Data migrations | Per AGENTS.md — behavior change only |
| M16 internal renames | Plan uses current symbols (`isAgentTabActive`, `agentId`); rename when M16 ships |
| Embedded terminal / new OpenCode features | Unrelated |

---

## Target behavior (spec)

### When sidecar **may spawn** (attach + `opencode serve`)

| Trigger | Spawn? |
| --- | --- |
| User clicks **Send** on an active session tab | **Yes** (primary) |
| Settings → **Check connection** (sidecar mode) | **Yes** (explicit retry; clears circuit breaker) |
| Settings → **Refresh model list** | **Yes** |
| User opens OpenCode config sub-panels (providers, MCP, agents, etc.) | **Yes** (explicit) |
| Workspace add / switch / lifecycle | **No** |
| File/editor tab active | **No** |
| Session tab open (idle, no Send) | **No** |
| Catalog prefetch on session tab mount | **No** (defer until Send or Settings refresh) |
| Circuit breaker active (hard failure) | **No** (except explicit Settings retry or Send with user intent — Send may attempt once and surface error) |

### When sidecar **must not run at all** (no attach, no backend calls)

- **Non-session tabs** (`isAgentTabActive === false`): file tabs, notepad-only, etc.
- Applies to: sidecar attach, catalog refresh, config store load, file-status
  OpenCode fetch, reconcile/hydrate, access-preflight-driven backend calls.

**Exception:** explicit Settings dialog actions may spawn regardless of which editor
tab is selected behind the dialog.

### Background reconcile + hydrate (session tab only, **no spawn**)

On **session tab** or **workspace switch while session tab is selected**, run
background reconcile + hydrate **only if all** of:

1. Sidecar is **already running and healthy** (status probe only — no attach).
2. Active session has a linked OpenCode session id (`opencodeSessionId`).
3. Thread has **≥ 1 message**.
4. **Last message role is `"user"`** (pending turn — user sent, assistant reply may
   still be in flight on server).

**L3-A (confirmed):** If the last message is from the **assistant**, skip server
hydrate on switch — local cache is sufficient; do not pull OpenCode on tab switch
after a completed turn.

Always show **local transcript** immediately on switch; background work is
best-effort, single-flight, non-blocking.

### Circuit breaker (hard failures)

Treat as **hard** (block automatic attach until user retry):

- `portInUse`, `missingBinary`, `launchFailure`, `healthTimeout` (after user-initiated start)

On hard failure:

1. Set `opencodeHealth.status = "error"` with actionable `lastErrorMessage`.
2. Set circuit-breaker flag (in-memory; not persisted — app restart clears).
3. Show **one deduped snackbar** per failure episode:
   *“OpenCode could not start. Check Settings → Workspaces → OpenCode.”*
4. Do **not** auto-retry on workspace switch, session tab switch, or effect re-runs.

**Clear breaker:** user clicks **Check connection**, toggles OpenCode enabled/mode,
changes sidecar port (when M14 exists), or successful explicit start.

### Health check vs start (sidecar mode)

| Action | Behavior |
| --- | --- |
| Automatic (effects) | `getOpencodeSidecarStatus` / lightweight probe — **no spawn** |
| Check connection (Settings) | May spawn / restart sidecar |
| Send | May spawn via `ensureOpencodeSidecar({ intent: "send" })` |

### URL mode

Unchanged: HTTP probe to configured `baseUrl`; never spawn. Circuit breaker applies
to probe failures only if we add repeated auto-probe (default: no auto-probe on
file tabs).

---

## Assumptions

- One sidecar process serves all workspaces (current Rust reuse behavior).
- Session tab = `isAgentTabActive` / `isAgentEditorPaneActive` (M16 may rename).
- “Last message” = last entry in the active session thread’s `messages` array
  (includes system/tool messages if present — document if we filter to user/assistant only in T5).
- `notify()` snackbar pattern exists on app shell (`+page.svelte` `statusMessage`).

---

## Confidence and Risks

Confidence: Medium–High.

Risks:

1. **Missed attach callsite** — `createClientForWorkspace` is used widely; central
   `ensureOpencodeSidecar` must gate all spawn paths.
2. **Composer model picker empty until refresh** — acceptable tradeoff; Settings
   **Refresh model list** and first Send populate catalog.
3. **Rust async spawn** — split command or background thread; must not leave zombie
   processes on fast tab switches.
4. **M15/M16 terminology** — user-facing copy uses **Session**; code may still say
   `agent` until M16.
5. **Interaction with M14 port** — ensure API should accept port from settings when
   M14 merges (no hard dependency).

---

## Decisions applied

| ID | Decision | Source |
| --- | --- | --- |
| L1 | Lazy spawn: **Send** + explicit Settings actions only | User + recommendation |
| L2 | **Non-session tabs** never trigger sidecar automatically | User |
| L3 | Background reconcile/hydrate: sidecar healthy + linked session + ≥1 msg + last msg `user` | User (option C refined) |
| L3-A | Skip hydrate when last msg is `assistant` | User answer **A** |
| L4 | Circuit breaker on hard failure; retry only via Settings / explicit Send | Recommendation |
| L5 | Snackbar once per failure episode (deduped) | Recommendation |
| L6 | Composer: allow typing; start on Send with spinner | Recommendation (Q4-B) |
| L7 | Non-blocking sidecar: **frontend single-flight + Rust spawn off IPC path** | Recommendation (Q5-B) |
| L8 | URL mode unchanged | Recommendation (Q6-A) |
| L9 | Remove eager attach from `syncOpencodeSidecarEffect` | Recommendation |

---

## Agent Level Legend

- `easy`: localized change, clear acceptance criteria.
- `medium`: cross-module wiring, several callsites.
- `heavy`: lifecycle + Rust + send pipeline coordination.

## Changelog Instructions

- When a task is completed, mark it `[DONE]` in this file.
- Add entries to `specs/changelog.md` (dated with time).

---

## Task Breakdown

#### Task 1: `ensureOpencodeSidecar` service (M13.5-T1) [Score:8] [Agent:medium] `[DONE]`

**Required context:** `opencodeSidecar.ts`, `appShellEffects.ts`,
`workspaceAgentBackend.ts` (`createClientForWorkspace`), `domain/settings.ts`
(`OpencodeHealthState`)

- Add `app/src/lib/services/opencodeSidecarEnsure.ts` (name illustrative):
  - Intents: `"send" | "settings" | "background-sync" | "status-only"`.
  - **Single-flight** promise for concurrent attach requests (share result).
  - **Circuit breaker** state: `hardFailureBlocked` + last error; in-memory only.
  - `hardFailureBlocked` → reject/`null` for `"background-sync"` and automatic paths;
    `"send"` and `"settings"` may attempt and clear on success.
  - Map Rust `OpencodeSidecarError` kinds to hard vs soft.
  - Update `opencodeHealth` via injected callback (same as today’s `setOpencodeHealth`).
- Export helpers: `isOpencodeSidecarBlocked()`, `clearOpencodeSidecarCircuitBreaker()`.
- Unit tests: single-flight, breaker blocks background, settings clears breaker.

**Acceptance checklist**

- Two parallel `ensure` calls → one Tauri invoke.
- After `portInUse`, automatic ensure returns blocked without invoke.
- Settings intent clears breaker and invokes attach.

Dependencies: none.

---

#### Task 2: Remove eager attach from shell effects (M13.5-T2) [Score:7] [Agent:medium] `[DONE]`

**Required context:** `appShellEffects.ts` (`syncOpencodeSidecarEffect`,
`requestOpencodeHealthRefresh`), `+page.svelte` effects

- **`syncOpencodeSidecarEffect`** (sidecar mode):
  - Remove `attachOpencodeSidecarWorkspace`.
  - Require `isAgentTabActive` for any sidecar-mode health work (or skip entirely
    when not session tab — prefer skip all OpenCode when file tab).
  - Set health to `checking` → `getOpencodeSidecarStatus` / probe only.
  - Respect circuit breaker (skip probe storm if already error + blocked).
- **`requestOpencodeHealthRefresh`** (Settings **Check connection**):
  - Sidecar mode: use `ensure` with intent `"settings"` (may spawn).
- **`syncOpencodeToggleEffect`**: unchanged stop when disabled.
- Update `appShellEffects.opencodeSidecar.test.ts`.

**Acceptance checklist**

- Workspace activation on file tab → **zero** `attach` invokes.
- Sidecar mode health effect does not call `opencode_sidecar_attach_workspace`.
- Check connection still can start sidecar.

Dependencies: Task 1.

---

#### Task 3: Session-tab gating across automatic OpenCode consumers (M13.5-T3) [Score:8] [Agent:medium] `[DONE]`

**Required context:** `+page.svelte` (M5 effects, opencode sidecar effect),
`ChatPanel.svelte`, `fileStatusTracker.ts`, `opencodeCatalog.ts`,
`appShellEffects.ts` (`syncAgentTabEffect`, `syncChatAccessMonitorEffect`)

- Gate **automatic** OpenCode backend usage on `isAgentTabActive`:
  - `refreshFileStatuses` effect in `+page.svelte` — only when session tab active.
  - `ChatPanel` catalog `$effect` — remove auto-refresh on mount; optional manual
    “Refresh models” in composer or rely on Settings/Send.
  - `syncChatAccessMonitor` — already gated; verify no backend attach via preflight
    when file tab (readiness should not spawn).
- **`syncAgentTabEffect` / `restoreWorkspaceAgentSession`**:
  - When switching workspace on **file tab**, skip reconcile/hydrate (or pass flag).
- **`createClientForWorkspace`**: use `ensure` with intent; `"background-sync"`
  must not spawn (status-only / reuse running sidecar).
- Audit `createOpencodeBackendFromAppState` consumers triggered from shell effects.

**Acceptance checklist**

- File tab + workspace open → no attach, no catalog refresh, no file-status OpenCode fetch.
- Session tab selected → M5 panels still work **if sidecar already running** (T5/T6).

Dependencies: Task 1.

---

#### Task 4: Send pipeline & composer UX (M13.5-T4) [Score:7] [Agent:medium] `[DONE]`

**Required context:** `chatSendPipeline.ts`, `sendChatMessage.ts`, `ChatPanel.svelte`,
`providers/bootstrap.ts` (`createWorkspaceReadinessChecker`)

- Wire **Send** to `ensureOpencodeSidecar({ intent: "send" })` before first OpenCode
  API call in sidecar mode.
- Composer UX (L6):
  - Do **not** block typing when health is `unknown` / sidecar not started.
  - On Send: show in-flight “Starting OpenCode…” (reuse runtime/generating UI or
    composer disabled state) until ensure completes or fails.
- Update readiness checker:
  - Remove block for `unknown`/`checking` when sidecar not yet started (only block
    on `error` + circuit breaker or explicit user-facing message after failed Send).
- Settings explicit paths unchanged: `refreshOpencodeCatalog`, `loadOpencodeConfigStore`
  use intent `"settings"`.

**Acceptance checklist**

- Fresh workspace, session tab, sidecar off → Send starts sidecar then delivers message.
- Failed start → Send aborts with clear error; snackbar (T7).
- Composer editable before first Send.

Dependencies: Tasks 1–3.

---

#### Task 5: Conditional background reconcile & hydrate (M13.5-T5) [Score:7] [Agent:medium] `[DONE]`

**Required context:** `appShellAgentHandlers.ts` (`restoreWorkspaceAgentSession`,
`reconcileWorkspaceSessionMappings`), `workspaceAgentHydration.ts`,
`appShellEffects.ts` (`syncAgentTabEffect`)

- Add `maybeBackgroundSyncWorkspaceSession()`:
  - Runs only when **L3** conditions hold (session tab, sidecar healthy, linked
    session, ≥1 msg, last msg `user`).
  - Uses `ensure` intent `"background-sync"` — **never spawns**.
  - Runs reconcile + hydrate single-flight, non-blocking (`void` from effect).
- Hook points:
  - Session tab selected / workspace scope change **while session tab active**.
  - **Not** on file tab workspace switch.
- Skip when last message role is `assistant` (L3-A).
- Do not call on app session restore until user opens session tab (or L3 conditions met).

**Acceptance checklist**

- User message pending + sidecar running + switch session tab → background hydrate fires.
- Completed turn (last assistant) + switch → no OpenCode calls.
- Sidecar not running → no attach from background sync.

Dependencies: Tasks 1, 3.

---

#### Task 6: Rust non-blocking sidecar start (M13.5-T6) [Score:8] [Agent:heavy] `[DONE]`

**Required context:** `app/src-tauri/src/opencode_sidecar.rs`, `lib.rs` commands

- Avoid blocking IPC for up to 10s:
  - **Option A (preferred):** `attach` spawns process, returns immediately with
    `health: checking`; health poll via existing `opencode_sidecar_status` or new
    lightweight command; frontend ensure waits with async polling + timeout.
  - **Option B:** spawn + health wait on dedicated std thread; command waits on
    channel with same timeout cap.
- Preserve: port-in-use detection, stderr logging, stop on exit, reuse healthy child.
- Unit tests: status transitions, idempotent attach while starting.

**Acceptance checklist**

- `attach` returns in <500ms when spawn succeeds (health may still be checking).
- UI thread / webview not frozen during sidecar boot (manual QA).
- `cargo test` passes.

Dependencies: Task 1 (frontend polling contract).

---

#### Task 7: Hard-failure UX — snackbar & Settings copy (M13.5-T7) [Score:5] [Agent:easy] `[DONE]`

**Required context:** `+page.svelte` `notify`, `OpenCodeSettingsPanel.svelte`,
`opencodeSidecarEnsure.ts`

- On hard failure from ensure (automatic or Send):
  - Deduped snackbar (L5) via `notify()`.
  - Persist `opencodeHealth` error message (existing panel).
- Settings panel: clarify that **Check connection** retries after failure.
- Optional: link/button in snackbar opens Settings → Workspaces → OpenCode.

**Acceptance checklist**

- Port-in-use → one snackbar, no repeated attach on tab switch.
- Check connection after failure → breaker cleared, retry allowed.

Dependencies: Tasks 1, 2, 4.

---

#### Task 8: Tests, docs & README (M13.5-T8) [Score:6] [Agent:medium] `[DONE]`

**Required context:** `appShellEffects.opencodeSidecar.test.ts`,
`workspaceAgentBackend.test.ts`, `README.md`, `docs/opencode-integration.md`

- Tests:
  - File tab does not attach.
  - Circuit breaker + effect re-run.
  - Background sync conditions (last user vs assistant message).
  - Send path invokes ensure once.
- Docs:
  - README “Quick start”: sidecar starts on first session Send (or Settings check),
    not on folder open.
  - `docs/opencode-integration.md`: lazy lifecycle, session-tab gating, breaker.

**Acceptance checklist**

- `npm test`, `npm run check`, `cargo test` green.
- Docs match behavior.

Dependencies: Tasks 1–7.

---

## Suggested implementation order

```
M13.5-T1 (ensure service + breaker)
    → M13.5-T6 (Rust async spawn) — can parallel with T2/T3 after T1 contract sketched
    → M13.5-T2 (shell effects) + M13.5-T3 (session-tab gates)
    → M13.5-T5 (background sync)
    → M13.5-T4 (Send + composer)
    → M13.5-T7 (snackbar)
    → M13.5-T8 (tests + docs)
```

T6 may land after T2–T4 if frontend polling is stubbed first; full UX requires T6.

---

## Exit criteria

- [x] Sidecar does **not** start on workspace open/add or file-tab activity.
- [x] Sidecar starts on **Send** (session tab) and explicit Settings actions.
- [x] Hard failure sets circuit breaker; **no automatic retry** until user retry.
- [x] One deduped snackbar per failure episode with Settings guidance.
- [x] Background reconcile/hydrate only when L3 conditions hold (including L3-A).
- [x] Rust attach does not block UI for multi-second health polling.
- [x] Tests and docs updated; changelog entry for milestone completion.

---

## Milestone status

**M13.5 [DONE]** — UX/performance fix shipped 2026-06-23; compatible with
M14 (port setting) and M16 (rename). Independent milestone — recommended
landing before further OpenCode tooling work so dev workflows stay usable
when port 4096 is occupied.
