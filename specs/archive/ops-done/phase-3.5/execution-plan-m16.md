# Phase 3.5 Milestone 16 Execution Plan — Internal session rename (code & persistence)

**Spec:** [phase-3.5.md](./phase-3.5.md)  
**Index:** [execution-plan.md](./execution-plan.md)  
**Prerequisite:** [execution-plan-m15.md](./execution-plan-m15.md) (user-facing terminology must land first)

**Status:** complete

**Goal:** remove the implementation-level **agent** vocabulary for workspace **conversations**, renaming types, stores, components, tab kinds, and on-disk paths so code matches the user-facing **Session** model from M15.

**Agent** (OpenCode persona) names stay for: `OpencodeAgentEntry`, `opencodeAgentId`, Settings → Agents, `@agent:` mention tokens, `listAgents` SDK calls, config `agent:` keys.

How to use this plan: each task is independently reviewable but **disk layout (T5)** should land in one release cut — no partial migrations per AGENTS.md (breaking simplify acceptable pre-release).

---

## Problem

After M15, users see **Session** in the UI while the codebase still speaks **agent** for the same concept (`agentId`, `AgentsSidebar`, `AgentIndexEntry`, `agents.json`, agent tab type). That drift confuses contributors and keeps mixed terminology in comments, tests, and diagnostics.

## Scope

### In scope

| Area | Target rename (illustrative) |
| --- | --- |
| Domain types | `AgentIndexEntry` → `SessionIndexEntry`; thread file types; tab `agent` kind → `session` (or `workspaceSession`) |
| IDs in chat store | `agentId` → `sessionId` for conversation scope; `activeAgentId` → `activeSessionId` |
| Components | `AgentsSidebar` → `SessionsSidebar`; `AgentSidebarRow` → `SessionSidebarRow`; related CSS |
| Services | `chatAgents.ts` → `chatSessions.ts`; `agentsSidebarController` → `sessionsSidebarController`; `workspaceAgentSession.ts` merge/rename as needed |
| Persistence paths | `chat/{hash}/agents/` → `chat/{hash}/sessions/`; index file `agents.json` → `sessions.json` (or equivalent) |
| Handlers / effects | `appShellAgentHandlers` → `appShellSessionHandlers`; `restoreWorkspaceAgentSession` → `restoreWorkspaceSession` |
| Commands / menu | Any command ids or labels still saying **agent** for conversations |
| Tests & validation | Rename imports; update phase validation test descriptions |
| Docs (internal) | `docs/architecture.md`, code comments referencing old names |

### Out of scope

| Area | Reason |
| --- | --- |
| `opencodeAgentId`, persona types | Correct **Agent** meaning |
| `WorkspaceAgentBackend`, `workspaceAgentBackend.ts` | Backend bridges OpenCode SDK; rename optional later |
| `SessionState` in `workspace.ts` | Window/tab layout snapshot — different concept; consider `WindowSessionState` only if collision remains painful |
| `agentDone` notification event id | Cosmetic; optional alias in M16-T7 |
| Data migration shims | Per AGENTS.md — breaking path change acceptable; document re-open behavior |
| `chat-http` thread ids | May keep `agentId` in chat-http scope or unify under `sessionId` with context prefix — decide in T2 |

## Assumptions

- App is pre-release; no production users requiring upgrade paths.
- M15 user-facing strings are stable before large refactors.
- OpenCode SDK API surface (`session.*`, `app.agents`) is not renamed — only SpecOps wrappers.

## Confidence and Risks

Confidence: Medium.

Risks:

1. **Large diff** — touches most of `chatStore`, `appState` tabs, persistence, and shell wiring.
2. **Tab type union** — `TabState` agent tabs vs file tabs; every `isAgentTab` callsite must update.
3. **Persisted session.json** — `lastActiveAgentId` field in window snapshot; breaking rename clears restore unless one-time read of old key (explicitly out of scope unless user requests shim).
4. **Git grep churn** — `agent` substring matches OpenCode persona code; use structured renames, not blind replace.

## Decisions applied (defaults — confirm at kickoff)

| ID | Decision | Implication |
| --- | --- | --- |
| R1 | Conversation id field **`sessionId`** | Distinct from OpenCode `opencodeSessionId` link field (may become `linkedOpencodeSessionId` for clarity) |
| R2 | Tab kind **`session`** | `AgentTabState` → `SessionTabState` with `sessionId: string` |
| R3 | No migration shim | Old `agents/` folders ignored; document in changelog |
| R4 | Persona **`opencodeAgentId`** unchanged | Preserves OpenCode alignment |
| R5 | Backend module name optional | `workspaceAgentBackend.ts` rename deferred unless T6 included |

## Agent Level Legend

- `easy`: mechanical rename with compiler guidance.
- `medium`: cross-module API changes.
- `heavy`: persistence + tab system + store refactor in one pass.

## Changelog Instructions

- Mark tasks `[DONE]` in this file when complete.
- Log breaking persistence changes prominently in `specs/changelog.md`.

---

## Task Breakdown

#### Task 1: Domain model & contracts (M16-T1) [DONE] [Score:8] [Agent:medium]

**Required context:** `domain/chat.ts`, `domain/document.ts` (tabs), `domain/contracts.ts`

- Rename conversation index entry type and thread snapshot types.
- Rename tab variant for workspace conversations (`sessionId` on tab state).
- Rename `lastActiveAgentId` → `lastActiveSessionId` on window `SessionState` (or document dual-read in T5 only if explicitly requested — default: breaking rename).
- Keep `opencodeAgentId` on thread metadata for persona selection.
- Export map in `contracts.ts`.

**Acceptance:** Typecheck passes with old names removed from domain layer.

Dependencies: M15 complete.

---

#### Task 2: chatStore slice rename (M16-T2) [DONE] [Score:9] [Agent:heavy]

**Required context:** `state/chatStore/agents.ts` → sessions module, `threadMessages.ts`, `runtime.ts`, `access.ts`

- Rename `agents.ts` → `sessions.ts` (or split index vs CRUD with clear names).
- `createDraftAgent` → `createDraftSession`; `deleteAgent` → `deleteSession`; `forkAgent` → `forkSession`; etc.
- `WorkspaceAgentsState` → `WorkspaceSessionsState`; `agentIndex` → `sessionIndex`; `threadsByAgentId` → `threadsBySessionId`.
- Update all store method names and exports from `chatStore.ts` barrel.

**Acceptance:** Store tests pass with new API; no `AgentIndexEntry` in chat store public surface.

Dependencies: Task 1.

---

#### Task 3: appState tabs & routing (M16-T3) [DONE] [Score:8] [Agent:medium]

**Required context:** `documentTabsSlice.ts`, `editorRouting.ts`, `closeTabFlow.ts`, `TabBar.svelte`

- `openOrFocusAgentTab` → `openOrFocusSessionTab`; `closeTabsForAgent` → `closeTabsForSession`; `isAgentTab` → `isSessionTab`.
- Update tab strip rendering and context menus.

**Acceptance:** Open/focus/close session tabs works; file tabs unchanged.

Dependencies: Task 1.

---

#### Task 4: App shell handlers & effects (M16-T4) [DONE] [Score:7] [Agent:medium]

**Required context:** `appShellAgentHandlers.ts`, `appShellEffects.ts`, `+page.svelte` wiring

- Rename handler module and exports; update prop names on `AppShell`, `ChatPanel`, `AgentsSidebar` (or renamed sidebar).
- `syncAgentTabEffect` → `syncSessionTabEffect`; `lastActiveAgentId` wiring → session id.

**Acceptance:** Fork/rename/share/export flows unchanged functionally.

Dependencies: Tasks 2–3.

---

#### Task 5: Persistence paths & codecs (M16-T5) [DONE] [Score:9] [Agent:heavy]

**Required context:** `chatPersistenceCodec.ts`, `chatPersistence.ts`, `chatPersistence.test.ts`

- Disk layout: `agents/` → `sessions/`; index filename and JSON envelope keys (`agents` array → `sessions`).
- Update path helpers and codec encode/decode.
- **No migration** — document that existing agent folders are abandoned pre-release.
- Update validation tests and golden fixtures.

**Acceptance:** New workspaces persist under `sessions/`; tests prove round-trip.

Dependencies: Task 2.

---

#### Task 6: UI components rename (M16-T6) [DONE] [Score:7] [Agent:medium]

**Required context:** `AgentsSidebar.svelte`, `AgentSidebarRow.svelte`, `agents-sidebar.css`, `agentsSidebarController.ts`

- Rename component files and imports (`SessionsSidebar`, etc.).
- Rename CSS classes where feasible (`agents-sidebar` → `sessions-sidebar`) or accept alias period.
- Update `AppShell.svelte` props (`agentsSidebar` → `sessionsSidebar`).

**Acceptance:** `npm run check` clean; UI identical to M15 (copy already correct).

Dependencies: Tasks 3–4.

---

#### Task 7: Diagnostics, events & misc identifiers (M16-T7) [DONE] [Score:5] [Agent:easy]

**Required context:** `agentNotificationObserver.ts`, `NotificationEventId`, `chatSendPipeline.ts` failure reason `no_agent`

- Rename internal enums/ids where they mean **conversation** (`no_agent` → `no_session`, optional `agentDone` → `sessionDone` with persisted settings key break).
- Update diagnostic `kind` strings if user-visible in logs panel.

**Acceptance:** Grep for conversation-scoped `agentId` in TS (excluding OpenCode persona) → zero or documented exceptions.

Dependencies: Task 2.

---

#### Task 8: Documentation & architecture (M16-T8) [DONE] [Score:4] [Agent:easy]

**Required context:** `docs/architecture.md`, `docs/opencode-integration.md`, `AGENTS.md` if needed

- Replace internal architecture terms (agent index → session index).
- Document disk layout and breaking persistence change.

**Acceptance:** Architecture doc matches code symbols post-rename.

Dependencies: Tasks 1–7.

---

#### Task 9: Full test sweep & validation milestones (M16-T9) [DONE] [Score:6] [Agent:medium]

**Required context:** `phase3*.validation.test.ts`, `chatM5-2.validation.test.ts`, etc.

- Fix imports and identifiers in validation tests.
- Run `npm test`, `npm run check`, `cargo test`.

**Acceptance:** CI-equivalent green locally.

Dependencies: Tasks 1–8.

---

## Suggested implementation order

```
M16-T1 (domain)
    → M16-T2 (chatStore) + M16-T3 (tabs) in parallel
    → M16-T5 (persistence) — same PR as T2 if possible
    → M16-T4 (shell handlers)
    → M16-T6 (components)
    → M16-T7 (diagnostics)
    → M16-T8 + M16-T9
```

## Exit criteria

- [x] No conversation-scoped **`agentId`** / **`AgentIndexEntry`** in public TS APIs.
- [x] Sidebar component and persistence paths use **session** naming.
- [x] OpenCode **persona** symbols still use **agent** (`opencodeAgentId`, Settings Agents).
- [x] M15 user-facing strings unchanged (still **Session** / **Agent** in UI).
- [x] Breaking disk layout documented; no migration shim.
- [x] All tests and `svelte-check` pass.

## Milestone status

**M16 complete** — internal agent → session rename applied across domain, chat store, app state, persistence, shell handlers/effects, components, and diagnostics. `npm test` 1799/1799, `npm run check` 0/0, `cargo test` 20/20.
