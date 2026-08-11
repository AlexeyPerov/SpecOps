# Phase 3 Milestone 3.5 Execution Plan — OpenCode opt-in gating

**Spec:** [phase-3.md](./phase-3.md)  
**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [execution-plan-m3.md](./execution-plan-m3.md) complete (phase-3 MVP cutover)

Post-MVP follow-up. Phase 3 shipped workspace agents as always-on OpenCode infrastructure: opening a workspace folder in **Sidecar** mode immediately starts the OpenCode sidecar, even when the user only wants folder editing. This milestone adds an explicit **Use OpenCode** setting and hides workspace agent affordances when disabled.

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task.

## Problem

Today:

1. `OpencodeSettings` has only `mode` (`sidecar` | `url`) and `baseUrl` — no enable/disable flag.
2. `syncOpencodeSidecarEffect` in `appShellEffects.ts` calls `attachOpencodeSidecarWorkspace` whenever `activeWorkspaceRoot` is set and mode is `sidecar`.
3. `createClientForWorkspace` in `workspaceAgentBackend.ts` also attaches the sidecar on every backend client creation (send, catalog, session restore).
4. `ChatPanel.svelte` auto-refreshes the OpenCode catalog when a workspace is active.
5. Workspace sends always route through OpenCode (`shouldUseWorkspaceAgentBackend` for `ws-*` contexts).

Result: **any open workspace folder starts OpenCode** (sidecar mode) regardless of whether the user intends to use agents. There is no SpecOps setting to opt out.

## Goal

Add **`opencode.enabled`** (product copy: **Use OpenCode for workspace agents**) so users can use workspaces purely as folder editors without spawning OpenCode or seeing agent UI.

When **disabled**:

- Do **not** start or attach the OpenCode sidecar.
- Do **not** health-check URL mode endpoints.
- Do **not** refresh OpenCode catalog or reconcile OpenCode sessions.
- **Hide workspace agent affordances entirely** (agents sidebar, new-agent actions, agent tab shell for workspace contexts).
- Block workspace agent sends with a clear setup message pointing to Settings.
- **Stop** a running sidecar when the user toggles off (best-effort via existing `stopOpencodeSidecar`).

When **enabled** (default): preserve current phase-3 MVP behavior unchanged.

**Out of scope:** reintroducing HTTP workspace chat as a fallback; lazy-start sidecar only on first agent interaction (optional future optimization, not required here).

## Assumptions

- Phase-3 MVP is complete; workspace agents remain OpenCode-only when enabled.
- Default `enabled: true` preserves behavior for existing installs (no migration shims).
- Chat (`chat-http`) and Cloud (`chat-cloud`) lanes are unaffected.
- Agent affordances for **Chat** context remain visible regardless of this setting.

## Confidence and Risks

Confidence: High.

Resolved constraints:

1. Gating points are localized: `syncOpencodeSidecarEffect`, `createClientForWorkspace`, catalog refresh, send validation, shell layout.
2. `stopOpencodeSidecar` already exists for app teardown; can reuse when disabling.
3. User confirmed hiding workspace agent affordances when disabled is acceptable.

Residual uncertainties:

1. Persisted agent tabs / session links when toggling off — prefer deterministic cleanup (close agent tabs, skip restore) over half-active UI.
2. Settings panel OpenCode subsection should reflect disabled state (transport/health controls hidden or read-only with explanation).

## Decisions applied

| ID | Decision | Implication |
|----|----------|-------------|
| G1 | `opencode.enabled: boolean`, default `true` | Persisted in `settings.json` under `opencode` |
| G2 | Hide workspace agent affordances when disabled | Agents sidebar hidden for `ws-*`; no new agent tab entry points; switch away from active workspace agent tab |
| G3 | No HTTP fallback when disabled | Workspace folder editing only; agents unavailable until re-enabled |
| G4 | Chat lane unchanged | `chat-http` agents sidebar and sends ignore `opencode.enabled` |
| G5 | Toggle off stops sidecar | Call `stopOpencodeSidecar` when `enabled` goes `true → false` in sidecar mode |

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 1: Settings schema and persistence (P3-9) [Score:5] [Agent:easy] [DONE]

**Required context**

1. [phase-3.md](./phase-3.md) — Settings deliverable
2. `app/src/lib/domain/settings.ts` — `OpencodeSettings`
3. `app/src/lib/services/opencodeSettings.ts` — normalize/defaults
4. `app/src/lib/services/settingsStore.ts` — persisted settings load/save

- Add `enabled: boolean` to `OpencodeSettings` (default `true`).
- Normalize in `normalizeOpencodeSettings` (missing/invalid → `true`).
- Persist via existing `settings.json` `opencode` block; no secrets change.
- Export a small helper e.g. `isOpencodeEnabled(settings)` for runtime gates.
- Update `settingsStore` tests and `opencodeSettings.test.ts`.

**Acceptance checklist**

- Fresh install defaults to `enabled: true`.
- Legacy settings without `enabled` normalize to `true`.
- Typecheck and unit tests pass.

Dependencies: none.

---

#### Task 2: Gate OpenCode runtime lifecycle (P3-9) [Score:7] [Agent:medium] [DONE]

**Required context**

1. Task 1 output
2. `app/src/lib/services/appShellEffects.ts` — `syncOpencodeSidecarEffect`, `requestOpencodeHealthRefresh`
3. `app/src/lib/ai/backends/workspaceAgentBackend.ts` — `createClientForWorkspace`
4. `app/src/lib/ai/opencodeCatalog.ts` — `refreshOpencodeCatalog`
5. `app/src/lib/services/appShellAgentHandlers.ts` — session restore reconciliation
6. `app/src/routes/+page.svelte` — effects wiring

- Early-return in `syncOpencodeSidecarEffect` when `!opencode.enabled`; reset health to `unknown` / idle copy (not `error`).
- Early-return in `requestOpencodeHealthRefresh` when disabled.
- Gate `createClientForWorkspace` sidecar attach and client creation when disabled (throw `WorkspaceAgentBackendError` with actionable code/message).
- Gate `refreshOpencodeCatalog` when disabled (return idle empty catalog without network).
- Skip OpenCode session restore/reconcile in `appShellAgentHandlers` when disabled.
- On `enabled: true → false`: call `stopOpencodeSidecar()` (sidecar mode only).
- On `enabled: false → true`: existing attach/health flow resumes on next workspace effect.

**Acceptance checklist**

- Opening a workspace with `enabled: false` does not invoke Tauri sidecar commands.
- Toggling off stops a running sidecar.
- Toggling on restores current sidecar/URL behavior.
- Catalog refresh and session reconcile do not run when disabled.

Dependencies: Task 1.

---

#### Task 3: Gate sends and validation (P3-9) [Score:6] [Agent:medium] [DONE]

**Required context**

1. Tasks 1–2 outputs
2. `app/src/lib/ai/chatSendPipeline.ts` — `shouldUseWorkspaceAgentBackend`, `validateOpencodeBackendSend`
3. `app/src/lib/ai/sendChatMessage.ts`, `retryChatTurn.ts`
4. `app/src/lib/ai/chatErrorCopy.ts` — user-facing blocked messages

- Extend `shouldUseWorkspaceAgentBackend` (or adjacent check) to return false when `!opencode.enabled`.
- Add explicit blocked validation in `validateOpencodeBackendSend` when disabled (recovery hint → enable in Settings).
- Ensure `chat-http` sends never hit this gate.
- Add/adjust tests in `sendChatMessage.test.ts`, `chatSendPipeline.test.ts`, `phase3M3.validation.test.ts`.

**Acceptance checklist**

- Workspace sends blocked with clear copy when disabled.
- Workspace sends unchanged when enabled.
- `chat-http` non-regression holds.

Dependencies: Task 1.

---

#### Task 4: Hide workspace agent affordances (P3-9) [Score:7] [Agent:medium] [DONE]

**Required context**

1. Tasks 1–3 outputs
2. `app/src/routes/+page.svelte` — `showAgentsSidebar`, `agentsSidebar`, `isAgentTabActive`
3. `app/src/lib/services/appShellHelpers.ts` — agent tab layout
4. Command/menu handlers that create or focus agent tabs (grep `handleNewAgent`, `createDraftAgent`, agent tab open paths)
5. `app/src/lib/components/ChatPanel.svelte` — workspace empty hints

- When `!opencode.enabled` and workspace is active (`ws-*`):
  - Hide agents sidebar (`showAgentsSidebar` false for workspace; still show for `chat-http`).
  - Remove or disable menu/command entry points for **New agent** in workspace context.
  - If an agent tab is active when disabled (toggle or restore), switch to a file tab or notepad deterministically.
  - Do not mount workspace `ChatPanel` agent composer surface for workspace when disabled (or show single-line “Enable OpenCode in Settings” — prefer hide per G2).
- Skip catalog `$effect` in `ChatPanel.svelte` when disabled.
- Update workspace empty-hint copy if any agent-only surfaces remain reachable.

**Acceptance checklist**

- Workspace folder open with OpenCode off: no agents sidebar, no agent tab shell, project panel/editor unchanged.
- Chat context sidebar still works when OpenCode off.
- Enabling OpenCode restores agents sidebar and agent tab behavior.

Dependencies: Tasks 1–2.

---

#### Task 5: Settings UI and docs (P3-9) [Score:5] [Agent:easy] [DONE]

**Required context**

1. Tasks 1–4 outputs
2. `app/src/lib/components/settings/ConnectionsSettingsPanel.svelte`
3. `README.md` — Workspace agents (OpenCode) section
4. [phase-3.md](./phase-3.md), `docs/providers.md`

- Add **Use OpenCode for workspace agents** toggle at top of **Workspaces / OpenCode** settings section.
- When off: hide or collapse transport, password, health, and refresh-model controls; show short note that folder editing continues without agents.
- When on: current subsection behavior unchanged.
- Update README to state sidecar starts only when OpenCode is enabled.
- Add note in `phase-3.md` post-MVP / follow-up referencing this plan.

**Acceptance checklist**

- Toggle persists and drives runtime immediately (via existing settings persistence effect).
- User-facing docs no longer imply unconditional sidecar start on workspace open.

Dependencies: Tasks 1–4.

---

#### Task 6: Tests and validation (P3-9) [Score:6] [Agent:medium] [DONE]

**Required context**

1. Tasks 1–5 outputs
2. `app/src/lib/services/appShellEffects.opencodeSidecar.test.ts`
3. Phase-3 validation tests

- Extend sidecar effect tests: disabled → no attach; enabled → attach unchanged.
- Test toggle-off triggers stop (mock `stopOpencodeSidecar`).
- Test send blocked / routing false when disabled.
- Smoke checklist (manual):
  1. Disable OpenCode → open workspace → confirm no sidecar, no agents sidebar.
  2. Enable → confirm sidecar healthy, agents sidebar returns, prompt works.
  3. Chat context works with OpenCode disabled.
- Run `npm test` and `npm run check` from `app/`.

**Acceptance checklist**

- Automated tests cover enable/disable invariants.
- Quality gate green.
- Manual smoke passes.

Dependencies: Task 5.

---

## Dependency graph

```text
Task 1 → Task 2 ─┐
      → Task 3 ──┼→ Task 4 → Task 5 → Task 6
```

Tasks 2 and 3 can run in parallel after Task 1.

## Mapping to phase-3 task IDs

| Phase-3 ID | Execution plan task |
|------------|---------------------|
| P3-9 (new) | Tasks 1–6 — OpenCode opt-in gating |

## Exit criteria

- [x] `opencode.enabled` setting exists; default `true`.
- [x] Sidecar does not start when disabled; stops when toggled off.
- [x] Workspace agent affordances hidden when disabled.
- [x] Workspace sends blocked with setup copy when disabled.
- [x] Enabled path matches pre-M3.5 behavior.
- [x] Chat and Cloud contexts unaffected.
- [x] `npm test` / `npm run check`; manual smoke on real folder.

## Key source files (implementation map)

| Area | Files |
| --- | --- |
| Settings type/normalize | `domain/settings.ts`, `services/opencodeSettings.ts`, `services/settingsStore.ts` |
| Sidecar lifecycle | `services/appShellEffects.ts`, `services/opencodeSidecar.ts`, `routes/+page.svelte` |
| Backend client | `ai/backends/workspaceAgentBackend.ts` |
| Catalog | `ai/opencodeCatalog.ts`, `components/ChatPanel.svelte` |
| Sends | `ai/chatSendPipeline.ts`, `ai/sendChatMessage.ts`, `ai/retryChatTurn.ts` |
| Shell / agents UI | `routes/+page.svelte`, `services/appShellHelpers.ts`, command handlers |
| Settings UI | `components/settings/ConnectionsSettingsPanel.svelte` |
| Session restore | `services/appShellAgentHandlers.ts` |
