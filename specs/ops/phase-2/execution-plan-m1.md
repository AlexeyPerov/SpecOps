# Phase 2 Milestone 1 Execution Plan — Context, rail, persistence

**Spec:** [phase-2.md](./phase-2.md)  
**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [phase-1 execution plan](../phase-1/execution-plan.md) complete

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task. Milestone 2 depends on this milestone completing.

## Assumptions

- Implementation is agent-only; human role is approval/review.
- Phase 1 foundations are complete: `ContextId` includes `chat-http`; `WindowContextState` / `WindowSessionSnapshot` have optional `chatHttp` placeholders (P1-7).
- Milestone 1 ships **infrastructure only** — no chat-only UI shell (M2) and no SSE streaming (M3).
- `chatStore` currently keys state by normalized workspace root path; milestone 1 migrates to context-id scope for `chat-http` while preserving workspace-root scope for `ws-*` contexts (B2A).
- Chat persistence path uses `chat/chat-http/` (fixed scope id), not workspace path hash.
- Breaking changes to session snapshot shape are acceptable (no migration shims).
- Rail gating policy: **hidden** Chat button until HTTP connection fully configured (A2D, roadmap gating table).

## Confidence and Risks

Confidence: Medium.

Resolved constraints:

1. Scope and exit criteria for milestone 1 are defined in [phase-2.md](./phase-2.md) (P2-1, P2-2, P2-3).
2. Gating rules are locked in [roadmap.md](../roadmap.md#activity-rail-gating-a2d).
3. Phase 1 HTTP provider and Connections settings exist; gating can reuse `isHttpProviderConfigured` plus default-model catalog check.

Residual uncertainties:

1. Whether `chatHttp` snapshot needs agent-tab session fields (`lastActiveAgentId`, layout) or a slimmer chat-only session shape — mirror notepad minimal tab state vs workspace layout fields.
2. `chatStore` rename (`activeWorkspaceRoot` → `activeChatScopeKey`) may touch many call sites; prefer additive API in M1, rename in M2 if scope is large.
3. Restoring `activeContextId: "chat-http"` when connection becomes unconfigured may need fallback to `notepad` (define policy in Task 2).

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 1: `chatHttp` context snapshot and helpers (P2-1) [Score:7] [Agent:medium] [DONE]

**Required context**

1. [phase-2.md](./phase-2.md) — Context & session deliverables
2. `app/src/lib/domain/contracts.ts` — `CHAT_HTTP_CONTEXT_ID`, `WindowContextState`, `WindowSessionSnapshot`
3. `app/src/lib/state/appState/contextHelpers.ts` — `getContextSnapshotById`, `patchActiveContext`, `patchContextById`

- Promote `chatHttp` from optional placeholder to required `ContextSnapshot` in runtime `WindowContextState` (default empty snapshot on bootstrap).
- Extend `getContextSnapshotById`, `patchActiveContext`, `patchContextById`, `reindexIdCountersFromContexts` for `chat-http` (mirror `notepad` branches).
- Add `getChatHttpContextSnapshot` / `isChatHttpContext` helpers if they reduce duplication across slices and `+page.svelte`.
- Ensure `chat-http` context has no `rootPath`; `getWorkspaceRoot("chat-http")` returns `null`.

**Acceptance checklist**

- `getContextSnapshotById(state, "chat-http")` returns `state.contexts.chatHttp` snapshot.
- Patching active context when `activeContextId === "chat-http"` updates `contexts.chatHttp`, not workspaces.
- Typecheck passes; no behavior change for notepad/workspace contexts yet.

Dependencies: none.

---

#### Task 2: Session persistence and context switch (P2-1) [Score:8] [Agent:medium]

**Required context**

1. [phase-2.md](./phase-2.md) — Persist `chatHttp` in `session.json`
2. `app/src/lib/state/appState/workspaceContextsSlice.ts` — `applyWindowSession`, `switchContext`, `toCurrentWindowSnapshot`
3. `app/src/lib/services/sessionManager.ts` — `toWindowSnapshot`, restore path

- Include `chatHttp` in `toCurrentWindowSnapshot` / `getWindowSessionSnapshot` / `sessionManager.toWindowSnapshot` read-write.
- Extend `applyWindowSession` to restore `chatHttp` snapshot; validate `activeContextId === "chat-http"` on load.
- Extend `switchContext` to allow `chat-http` when snapshot exists (no workspace `rootPath` required).
- Define fallback when restored `activeContextId` is `chat-http` but gating says connection not configured: fall back to `notepad` (or keep context but hide send — prefer fallback per A2D hidden-button UX).
- Wire `+page.svelte` `handleSelectContext` / `handleActiveContextSwitch` to recognize `chat-http` (no project-tree load).

**Acceptance checklist**

- `session.json` round-trips `chatHttp` snapshot alongside `notepad` and workspaces.
- User can programmatically/test switch to `chat-http` and back without corrupting other contexts.
- Invalid restore (chat-http active but connection removed) falls back safely.

Dependencies: Task 1.

---

#### Task 3: `chatStore` scope by context id + persistence path (P2-2) [Score:9] [Agent:heavy]

**Required context**

1. [phase-2.md](./phase-2.md) — `chatStore` scoped by context id; app data `chat/chat-http/`
2. `app/src/lib/state/chatStore/types.ts`, `workspace.ts`, `chatStore.ts`
3. `app/src/lib/services/chatPersistence.ts` — `workspaceChatPathHashKey`, debounced writes
4. `app/src/routes/+page.svelte` — `$effect` syncing `setActiveWorkspaceRoot`

- Introduce chat scope key type: `ChatScopeKey = ContextId` (or dedicated union) with `CHAT_HTTP_CONTEXT_ID` as fixed key for chat context.
- Add `setActiveChatScope(contextId: ContextId)` (or equivalent) that sets scope to `chat-http` without a workspace root.
- Refactor `chatPersistence` to resolve storage directory:
  - workspace contexts: existing `chat/{hash}/` keyed by normalized root path
  - `chat-http`: `chat/chat-http/` (literal scope segment, not path hash)
- Update agent index + thread file load/save/schedule paths for scope key.
- Update `+page.svelte` context effect: when `activeContextId === "chat-http"`, set chat scope to `chat-http` and skip workspace access preflight / `restoreWorkspaceAgentSession`.
- Preserve workspace chat behavior unchanged when `activeContextId` is `ws-*`.

**Acceptance checklist**

- Chat agents/threads for `chat-http` persist under `chat/chat-http/` (index + per-agent thread files).
- Workspace chat still persists under hashed workspace paths.
- Switching workspace ↔ chat-http loads correct agent index without cross-contamination.
- Debounced write timing matches existing workspace chat patterns (`PERSIST_DEBOUNCE_MS`).

Dependencies: Task 2.

---

#### Task 4: HTTP connection rail gating helper (P2-3) [Score:6] [Agent:medium]

**Required context**

1. [roadmap.md](../roadmap.md#activity-rail-gating-a2d) — Chat visible when connection configured
2. `app/src/lib/ai/providers/httpConnectionSettings.ts` — `isHttpProviderConfigured`
3. `app/src/lib/ai/providers/capabilityChecker.ts`, `providerModelCatalog.ts` — default model resolution

- Add `isChatHttpRailVisible(settings, apiKey, providerModelCatalogs)` (or `chatHttpRailGating.ts`) combining:
  - `enabled === true`
  - non-empty trimmed API key (from secrets / in-memory `providerApiKeys.http`)
  - valid trimmed `baseUrl`
  - default model resolvable from HTTP provider catalog (`getProviderDefaultModelId` or existing validation helper)
- Export pure function for unit tests; no UI yet.
- Document gating in function JSDoc referencing roadmap A2D.

**Acceptance checklist**

- Helper returns `false` when any gating condition fails; `true` only when all pass.
- Unit tests cover: disabled connection, missing key, empty baseUrl, empty catalog, valid full config.
- No Cloud (`chat-cloud`) gating mixed into this helper.

Dependencies: none (parallel with Tasks 1–2 after phase 1 complete).

---

#### Task 5: Activity rail Chat button and wiring (P2-3) [Score:7] [Agent:medium]

**Required context**

1. [phase-2.md](./phase-2.md) — Activity rail deliverables, gating
2. `app/src/lib/components/ActivityRail.svelte`
3. `app/src/routes/+page.svelte` — rail props, `handleSelectContext`
4. Task 4 gating helper

- Add Chat rail button **after Notepad separator**, before workspace list (A2D order).
- Distinct icon + tooltip (not Cloud/Notepad/workspace).
- Show button only when `isChatHttpRailVisible(...)` is true; hidden otherwise (prefer hidden over disabled per roadmap UX note).
- Wire `onclick` → `onSelectContext("chat-http")`.
- Pass gating inputs from `+page.svelte` (settings + api key + catalogs).
- Active state styling when `activeContextId === "chat-http"`.

**Acceptance checklist**

- Chat button appears only after Connections setup is complete (manual or test).
- Clicking Chat switches `activeContextId` to `chat-http`.
- Button hidden when connection incomplete; no crash when switching away from chat-http after config removed.
- Notepad and workspace rail buttons unchanged.

Dependencies: Tasks 2, 4.

---

#### Task 6: Milestone 1 tests and verification (P2-7 partial) [Score:7] [Agent:medium]

**Required context**

1. [phase-2.md](./phase-2.md) — exit criteria (partial)
2. `app/src/lib/state/appState.test.ts`, `sessionManager.test.ts`, `chatStore.test.ts`, `chatPersistence.test.ts`
3. Tasks 1–5 outputs

- Add/extend tests: context snapshot helpers for `chat-http`; session round-trip with `chatHttp`; `switchContext("chat-http")`; gating helper matrix; chat persistence path for `chat-http` scope.
- Add ActivityRail or page-level test for button visibility if test harness supports component mount.
- Run `npm test` and `npm run check` from `app/`.

**Acceptance checklist**

- New tests pass; no regressions in phase-1 workspace chat tests.
- `npm test` and `npm run check` pass from `app/`.
- Milestone 1 deliverables verifiable without chat UI shell (context switch + persistence + rail gating only).

Dependencies: Tasks 3, 5.

---

## Dependency graph

```text
Task 1 → Task 2 → Task 3 → Task 6
Task 4 → Task 5 → Task 6
```

Task 4 can start in parallel with Task 1.

## Mapping to phase-2 task IDs

| Phase-2 ID | Execution plan task |
|------------|---------------------|
| P2-1 | Tasks 1, 2 |
| P2-2 | Task 3 |
| P2-3 | Tasks 4, 5 |
| P2-4 | Milestone 2 |
| P2-5 | Milestone 3 |
| P2-6 | Milestone 2 |
| P2-7 | Task 6 (partial); completed in Milestone 3 |

## Milestone 1 exit criteria

- [ ] `chat-http` context loads/saves in session snapshot.
- [ ] Chat rail button visible when HTTP connection configured; hidden otherwise.
- [ ] `chatStore` + persistence scoped to `chat-http` under `chat/chat-http/`.
- [ ] Workspace HTTP chat unchanged (B2A).
- [ ] `npm test` / `npm run check` pass.

**Next:** [execution-plan-m2.md](./execution-plan-m2.md)
